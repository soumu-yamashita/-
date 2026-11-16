import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// 実際のNext.js API・Supabase SDKを通す。PostgRESTのHTTP境界はfixture。認証エンドポイントは提供しない。
const id='00000000-0000-4000-8000-000000000001';
const taskId='00000000-0000-4000-8000-000000000010';
let conflict=false;
let gateway: Server;
let app: ChildProcess;
let base='';
let logs='';
let rpcCalls=0;
let task={id:taskId,title:'確認',description:null,assignee_id:id,due_date:'2026-11-20',status:'todo',completed_at:null as string|null,created_by:id,created_at:'2026-11-16T00:00:00Z',updated_at:'2026-11-16T00:00:00Z',version:1};
async function call(path: string, method='GET', data?: unknown) {
  return fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',Cookie:'obsolete-session=ignored'},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
}
before(async()=>{
  gateway=createServer(async(req,res)=>{
    let raw=''; for await(const chunk of req) raw+=chunk;
    const body=raw?JSON.parse(raw):{};
    const url=new URL(req.url!,'http://localhost');
    res.setHeader('Content-Type','application/json');
    const send=(value:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    assert.equal(req.headers.authorization, 'Bearer sb_publishable_fixture_only');
    assert.equal(req.headers.apikey, 'sb_publishable_fixture_only');
    if(url.pathname==='/rest/v1/profiles') return send([{id,display_name:'山下 美咲',is_active:true,created_at:'2026-11-16T00:00:00Z'}]);
    if(url.pathname==='/rest/v1/tasks') return send([task]);
    if(url.pathname.startsWith('/rest/v1/rpc/')) {
      rpcCalls++;
      if(conflict) return send({code:'PT409',message:'version_conflict'},409);
      assert.equal(req.headers.accept,'application/vnd.pgrst.object+json');
      assert.equal(body.p_assignee_id,id);
      task={...task,title:body.p_title,version:url.pathname.endsWith('update_task')?task.version+1:1,status:body.p_status??'todo'};
      return send(task);
    }
    send({error:'unknown fixture endpoint'},404);
  });
  await new Promise<void>(r=>gateway.listen(0,'127.0.0.1',r));
  const upstream=`http://127.0.0.1:${(gateway.address() as {port:number}).port}`;
  const reservation=createServer(); await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r)); const port=(reservation.address() as {port:number}).port; await new Promise<void>(r=>reservation.close(()=>r())); base=`http://127.0.0.1:${port}`;
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:process.cwd(),env:{...process.env,SUPABASE_URL:upstream,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',APP_URL:base},stdio:['ignore','pipe','pipe']});
  app.stdout?.on('data',d=>{logs+=d;});app.stderr?.on('data',d=>{logs+=d;});
  for(let i=0;;i++){ try { if((await fetch(base+'/')).ok)break; } catch {} if(i>=80)throw Error('Next.js起動失敗: '+logs);await delay(250); }
});
after(async()=>{if(app){app.kill('SIGTERM');await new Promise<void>(r=>{if(app.exitCode!==null)return r();app.once('exit',()=>r());});} if(gateway)await new Promise<void>(r=>gateway.close(()=>r()));});

test('ログイン・Cookieなしで実APIから一覧を取得する', async()=>{
  const res=await call('/api/workspace'); assert.equal(res.status,200); const data=await res.json();
  assert.equal(data.members[0].name,'山下 美咲'); assert.equal(data.tasks[0].version,1);
  assert.equal('userId' in data,false); assert.deepEqual(res.headers.getSetCookie(),[]);
  assert.equal(res.headers.get('cache-control'),'private, no-store');
});
test('登録と更新でRPCへ渡し、単一行の戻り値を変換する',async()=>{const payload={title:'  新しいタスク  ',description:'',assignee:id,due:'2026-11-20',done:false};const created=await call('/api/tasks','POST',payload);assert.equal(created.status,201,await created.clone().text());assert.equal((await created.json()).title,'新しいタスク');const updated=await call('/api/tasks','PATCH',{...payload,id:taskId,version:1,done:true});assert.equal(updated.status,200);const data=await updated.json();assert.equal(data.done,true);assert.equal(data.version,2);assert.equal(rpcCalls,2);});
test('RPCの版競合を409として返す',async()=>{conflict=true;try{const res=await call('/api/tasks','PATCH',{id:taskId,version:1,title:'古い編集',description:'',assignee:id,due:'2026-11-20',done:false});assert.equal(res.status,409);assert.match((await res.json()).error,/別のメンバー/);}finally{conflict=false;}});
test('不正入力はRPCを呼ばず400にする',async()=>{const before=rpcCalls;const res=await call('/api/tasks','POST',{title:'',description:'',assignee:id,due:'2026-02-29',done:false});assert.equal(res.status,400);assert.equal(rpcCalls,before);});
test('旧ログインURLは画面を表示せず一覧へリダイレクト',async()=>{ const res=await call('/login');assert.equal(res.status,307);assert.equal(res.headers.get('location'),'/'); });
test('旧認証APIは提供しない',async()=>{const res=await call('/api/auth/login','POST',{email:'ignored@example.test',password:'unused'});assert.equal(res.status,404);});
