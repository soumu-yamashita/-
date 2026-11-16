import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

// 実際のPostgreSQLでDDL・RLS・RPCを実行。Supabase Authの境界だけを最小fixtureで再現。
const image = 'postgres:17-alpine@sha256:a77aa70e641402a21411b92b721c58d10f23b50ae5fdd2333efd22d166e1e5f7';
const alice = '00000000-0000-4000-8000-000000000001';
const bob = '00000000-0000-4000-8000-000000000002';
const disabled = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
let container = '';
let port = 0;
let admin: Client;
async function client() { const c = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }); await c.connect(); return c; }
async function asUser(id: string, role = 'authenticated') { const c = await client(); await c.query(`SET ROLE ${role}`); await c.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]); return c; }
async function userQuery(id: string, sql: string, values: unknown[] = [], role = 'authenticated') { const c = await asUser(id, role); try { return await c.query(sql, values); } finally { await c.end(); } }
// 複合型戻り値を展開する際の関数の複数評価を避けるため、FROMに置く。
const create = async (assignee = bob, title = 'テストタスク') => userQuery(alice, 'SELECT * FROM public.create_task($1,$2,$3,$4)', [title, null, assignee, '2026-11-20']);
async function update(id: string, version: number, status = 'done', assignee = bob) { return userQuery(alice, 'SELECT * FROM public.update_task($1,$2,$3,$4,$5,$6,$7)', [id, version, '更新後のタスク', null, assignee, '2026-11-21', status]); }
function hasCode(code: string) { return (e: unknown) => (e as { code: string }).code === code; }

before(async () => {
  container = execFileSync('docker', ['run', '--rm', '-d', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', image], { encoding: 'utf8' }).trim();
  port = Number(execFileSync('docker', ['inspect', '-f', '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}', container], { encoding: 'utf8' }).trim());
  for (let attempt = 0; ; attempt++) { try { admin = await client(); break; } catch (e) { if (attempt >= 40) throw e; await new Promise(r => setTimeout(r, 250)); } }
  await admin.query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; GRANT USAGE ON SCHEMA auth TO anon, authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;`);
  await admin.query(readFileSync(new URL('../supabase/migrations/202611160001_initial.sql', import.meta.url), 'utf8'));
  await admin.query('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [[alice,bob,disabled,outsider]]);
  await admin.query("INSERT INTO public.profiles(id,display_name,is_active) VALUES ($1,'山下',true),($2,'田中',true),($3,'無効メンバー',false)", [alice,bob,disabled]);
});
after(async () => { if (admin) await admin.end(); if (container) execFileSync('docker', ['stop', '-t', '1', container], { stdio: 'ignore' }); });

test('登録者・初期状態・版はDB側で決まる', async () => { const { rows: [task] } = await create(bob, '　企画書を作成　'); assert.equal(task.title,'企画書を作成'); assert.equal(task.created_by,alice); assert.equal(task.status,'todo'); assert.equal(task.completed_at,null); assert.equal(Number(task.version),1); });
test('有効メンバーのみ参照でき、profilesポリシーが再帰しない', async () => { assert.equal((await userQuery(alice,'SELECT * FROM public.profiles')).rowCount,3); assert.ok((await userQuery(bob,'SELECT * FROM public.tasks')).rowCount! > 0); for (const id of [disabled,outsider]) { assert.equal((await userQuery(id,'SELECT * FROM public.tasks')).rowCount,0); assert.equal((await userQuery(id,'SELECT * FROM public.profiles')).rowCount,0); } });
test('匿名アクセスとRPC実行を拒否する', async () => { await assert.rejects(userQuery('', 'SELECT * FROM public.tasks', [], 'anon'), hasCode('42501')); await assert.rejects(userQuery('', 'SELECT * FROM public.create_task($1,$2,$3,$4)', ['x',null,bob,'2026-11-20'], 'anon'), hasCode('42501')); });
test('未登録・無効なメンバーのRPCを拒否する', async () => { for (const id of [disabled,outsider]) await assert.rejects(userQuery(id, 'SELECT * FROM public.create_task($1,$2,$3,$4)', ['x',null,bob,'2026-11-20']),hasCode('42501')); });
test('直接の書き込み・自己有効化を拒否する', async () => { for (const sql of ["INSERT INTO public.tasks(title,assignee_id,due_date,created_by) VALUES ('x', $1, '2026-11-20', $1)", "UPDATE public.tasks SET created_by=$1", "DELETE FROM public.tasks WHERE created_by=$1", 'UPDATE public.profiles SET is_active=true WHERE id=$1']) await assert.rejects(userQuery(alice,sql,[alice]), hasCode('42501')); });
test('入力制約と無効担当者を検証する', async () => { await assert.rejects(create(bob,'　 \t'),hasCode('23514')); await assert.rejects(create(bob,'a'.repeat(101)),hasCode('23514')); await assert.rejects(create(disabled),hasCode('22023')); await assert.rejects(userQuery(alice,'SELECT * FROM public.create_task($1,$2,$3,$4)',['x','a'.repeat(5001),bob,'2026-11-20']),hasCode('23514')); await assert.rejects(userQuery(alice,'SELECT * FROM public.create_task($1,$2,$3,$4)',['x',null,bob,'infinity']),hasCode('23514')); });
test('完了日時は完了時設定・完了のまま編集で維持・再開で解除', async () => { const t = (await create()).rows[0]; const done = (await update(t.id,1)).rows[0]; assert.equal(done.status,'done'); assert.ok(done.completed_at); const edited = (await update(t.id,2)).rows[0]; assert.equal(edited.completed_at.getTime(),done.completed_at.getTime()); const reopened = (await update(t.id,3,'todo')).rows[0]; assert.equal(reopened.completed_at,null); assert.equal(Number(reopened.version),4); assert.equal(reopened.created_at.getTime(),t.created_at.getTime()); });
test('同じ版の並行更新は片方だけ成功する', async () => { const t = (await create()).rows[0]; const results = await Promise.allSettled([update(t.id,1),update(t.id,1)]); assert.equal(results.filter(r=>r.status==='fulfilled').length,1); const rejected = results.find(r=>r.status==='rejected') as PromiseRejectedResult; assert.equal(rejected.reason.code,'PT409'); });
test('無効化された担当者のタスクは編集・再割当できる', async () => { const t = (await create()).rows[0]; await admin.query('UPDATE public.profiles SET is_active=false WHERE id=$1',[bob]); try { assert.equal((await update(t.id,1,'todo')).rows[0].assignee_id,bob); assert.equal((await update(t.id,2,'todo',alice)).rows[0].assignee_id,alice); await assert.rejects(create(),hasCode('22023')); } finally { await admin.query('UPDATE public.profiles SET is_active=true WHERE id=$1',[bob]); } });
test('メンバー削除ではタスクを消さず外部キーで保護する', async () => { await assert.rejects(admin.query('DELETE FROM public.profiles WHERE id=$1',[bob]),hasCode('23503')); await assert.rejects(admin.query('DELETE FROM auth.users WHERE id=$1',[alice]),hasCode('23503')); });
test('無効化と書き込みのロックが競合し、無効化後の書き込みを拒否', async () => {
  const c = await client(); const pending = await asUser(alice); try {
    await c.query('BEGIN'); await c.query('UPDATE public.profiles SET is_active=false WHERE id=$1',[alice]);
    let completed=false; const writing = pending.query('SELECT * FROM public.create_task($1,$2,$3,$4)',['x',null,bob,'2026-11-20']).then(()=>{completed=true; return null;},e=>{completed=true; return e;});
    await new Promise(r=>setTimeout(r,150)); assert.equal(completed,false); await c.query('COMMIT'); const error=await writing; assert.equal(error.code,'42501');
  } finally { await c.query('ROLLBACK'); await c.end(); await pending.end(); await admin.query('UPDATE public.profiles SET is_active=true WHERE id=$1',[alice]); }
});
