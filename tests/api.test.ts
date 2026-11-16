import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// 実際のNext.js API・Supabase SDKを通す。Auth/PostgRESTのHTTP境界はfixture。
const id='00000000-0000-4000-8000-000000000001';
const taskId='00000000-0000-4000-8000-000000000010';
const user={id,aud:'authenticated',role:'authenticated',email:'member@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-11-16T00:00:00Z'};
let active=true;
let conflict=false;
let gateway: Server;
let app: ChildProcess;
let base='';
let cookie='';
let token='';
let logs='';
let rpcCalls=0;
let task={id:taskId,title:'確認',description:null,assignee_id:id,due_date:'2026-11-20',status:'todo',completed_at:null as string|null,created_by:id,created_at:'2026-11-16T00:00:00Z',updated_at:'2026-11-16T00:00:00Z',version:1};
async function call(path: string, method='GET', data?: unknown, useCookie=true) {
  const res=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie && useCookie?{Cookie:cookie}:{})},body:data===undefined?undefined:JSON.stringify(data),redirect:'manual'});
  if (useCookie) { const jar=new Map(cookie.split('; ').filter(Boolean).map(c=>{const i=c.indexOf('=');return [c.slice(0,i),c.slice(i+1)];})); for (const c of res.headers.getSetCookie()) { const first=c.split(';')[0]; const i=first.indexOf('='); if (first.slice(i+1)) jar.set(first.slice(0,i),first.slice(i+1)); else jar.delete(first.slice(0,i)); } cookie=Array.from(jar).map(([k,v])=>`${k}=${v}`).join('; '); }
  return res;
}
before(async()=>{
  gateway=createServer(async(req,res)=>{
    let raw=''; for await(const chunk of req) raw+=chunk;
    const body=raw?JSON.parse(raw):{};
    const url=new URL(req.url!,'http://localhost');
    res.setHeader('Content-Type','application/json');
    const send=(value:unknown,status=200)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(url.pathname==='/auth/v1/token') {
      if(body.password==='wrong') return send({error:'invalid_grant',error_description:'invalid credentials'},400);
      return send({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user});
    }
    if(url.pathname==='/auth/v1/user') return send(user);
    if(url.pathname==='/auth/v1/logout') {res.statusCode=204;return res.end();}
    if(url.pathname==='/auth/v1/recover') return send({});
    if(url.pathname==='/rest/v1/profiles') return send([{id,display_name:'山下 美咲',is_active:active,created_at:'2026-11-16T00:00:00Z'}]);
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
  token=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,aud:'authenticated',role:'authenticated',iss:upstream+'/auth/v1',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString('base64url'),'fixture-signature'].join('.');
  const reservation=createServer(); await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r)); const port=(reservation.address() as {port:number}).port; await new Promise<void>(r=>reservation.close(()=>r())); base=`http://127.0.0.1:${port}`;
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:process.cwd(),env:{...process.env,SUPABASE_URL:upstream,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture_only',APP_URL:base},stdio:['ignore','pipe','pipe']});
  app.stdout?.on('data',d=>{logs+=d;});app.stderr?.on('data',d=>{logs+=d;});
  for(let i=0;;i++){ try { if((await fetch(base+'/login')).ok)break; } catch {} if(i>=80)throw Error('Next.js起動失敗: '+logs);await delay(250); }
});
after(async()=>{if(app){app.kill('SIGTERM');await new Promise<void>(r=>{if(app.exitCode!==null)return r();app.once('exit',()=>r());});} if(gateway)await new Promise<void>(r=>gateway.close(()=>r()));});

test('未認証の実APIは401を返す',async()=>{const res=await call('/api/workspace');assert.equal(res.status,401);});
test('認証後はHttpOnly Cookieでセッションを管理する',async()=>{const res=await call('/api/auth/login','POST',{email:user.email,password:'test-password-123'});assert.equal(res.status,200,await res.text());assert.ok(res.headers.getSetCookie().some(v=>/httponly/i.test(v)));assert.ok(cookie);});
test('実SDK経由でメンバーとタスクを取得し、UI形式に変換する',async()=>{const res=await call('/api/workspace');assert.equal(res.status,200);const data=await res.json();assert.equal(data.userId,id);assert.equal(data.members[0].name,'山下 美咲');assert.equal(data.tasks[0].version,1);assert.equal(res.headers.get('cache-control'),'private, no-store');});
test('登録と更新でRPCへ渡し、単一行の戻り値を変換する',async()=>{const payload={title:'  新しいタスク  ',description:'',assignee:id,due:'2026-11-20',done:false};const created=await call('/api/tasks','POST',payload);assert.equal(created.status,201,await created.clone().text());assert.equal((await created.json()).title,'新しいタスク');const updated=await call('/api/tasks','PATCH',{...payload,id:taskId,version:1,done:true});assert.equal(updated.status,200);const data=await updated.json();assert.equal(data.done,true);assert.equal(data.version,2);assert.equal(rpcCalls,2);});
test('RPCの版競合を409として返す',async()=>{conflict=true;try{const res=await call('/api/tasks','PATCH',{id:taskId,version:1,title:'古い編集',description:'',assignee:id,due:'2026-11-20',done:false});assert.equal(res.status,409);assert.match((await res.json()).error,/別のメンバー/);}finally{conflict=false;}});
test('不正入力はRPCを呼ばず400にする',async()=>{const before=rpcCalls;const res=await call('/api/tasks','POST',{title:'',description:'',assignee:id,due:'2026-02-29',done:false});assert.equal(res.status,400);assert.equal(rpcCalls,before);});
test('無効メンバーをサーバー側でも拒否する',async()=>{active=false;try{const res=await call('/api/workspace');assert.equal(res.status,403);}finally{active=true;}});
test('ログアウト後は再び401になる',async()=>{const res=await call('/api/auth/logout','POST');assert.equal(res.status,200);assert.equal((await call('/api/workspace')).status,401);});
