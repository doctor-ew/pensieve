import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {TeamClient,ContributionQueue} from '../src/team-client.js';
import {makeMemory} from '../src/sessions.js';
import {createTeamServer} from '../src/team-server.js';
import {TeamStore} from '../src/team-store.js';
import {createConnectorApp} from '../src/agent-server.js';
import {remoteAgentServer} from '../src/team-service.js';
import {connectedClient} from '../src/team-cli.js';
import {beginBrowserConnection,readAgentConnection,connectionStatus,disconnectAgent,SignInRequired} from '../src/agent-connection.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'pensieve-agent-')),store=new TeamStore(':memory:');
 const alice=store.createUser('Alice'),bob=store.createUser('Bob');store.createPool(alice.user.id,'Alice pool','private');store.createPool(bob.user.id,'Bob pool','private');
 let app:ReturnType<typeof createConnectorApp>['app'];let refreshes=0;
 const http=createServer((req,res)=>{if(req.url==='/token'&&req.method==='POST')refreshes++;app(req,res);});http.listen(0,'127.0.0.1');await once(http,'listening');
 const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;
 const connector=createConnectorApp(store,{publicUrl:url,statePath:join(root,'oauth.sqlite'),loginPath:'/auth/login',sessionUser:async cookie=>cookie?.includes('actor=alice')?alice.user:cookie?.includes('actor=bob')?bob.user:undefined});app=connector.app;const legacy=createTeamServer(store,{publicUrl:url,ownerToken:'o'.repeat(40)});app.use((req,res)=>{legacy.emit('request',req,res);});
 async function approve(flow:{url:string},actor='alice'){
  const response=await fetch(flow.url,{redirect:'manual',headers:{Cookie:'actor='+actor}});assert.equal(response.status,200);
  const html=await response.text();assert.ok(!html.includes('name="credential"'));const nonce=html.match(/name="nonce" value="([^"]+)"/)![1];
  const consent=await fetch(url+'/connector/consent',{method:'POST',redirect:'manual',headers:{Origin:url,Cookie:response.headers.get('set-cookie')!.split(';')[0]+'; actor='+actor,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce,decision:'approve'})});assert.equal(consent.status,302);
  const callback=await fetch(consent.headers.get('location')!);assert.equal(callback.status,200,await callback.text());
 }
 return {root,url,store,alice,bob,connector,approve,count:()=>refreshes,close:async()=>{http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));connector.close();store.close();await rm(root,{recursive:true,force:true});}};
}
async function expire(home:string){const path=join(home,'agent-connection.json'),state=JSON.parse(await readFile(path,'utf8'));state.expiresAt=0;await writeFile(path,JSON.stringify(state));return state;}

test('browser sign-in, concurrent renewal, independent grants and same-process reconnection',async()=>{
 const f=await fixture(),home=join(f.root,'one'),other=join(f.root,'two');
 const mcp=remoteAgentServer(()=>connectedClient(home),home),client=new Client({name:'test',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);
 try{
  const flow=await beginBrowserConnection(home,f.url,'Agent one');
  const anonymous=await fetch(flow.url,{redirect:'manual'});assert.equal(anonymous.status,302);const login=new URL(anonymous.headers.get('location')!,f.url);assert.equal(login.pathname,'/auth/login');assert.equal(new URL(login.searchParams.get('returnTo')!,f.url).searchParams.get('state'),new URL(flow.url).searchParams.get('state'));
  const bad=new URL(new URL(flow.url).searchParams.get('redirect_uri')!);bad.search='state=wrong&code=bad';assert.equal((await fetch(bad)).status,400);
  await f.approve(flow);await flow.done;
  assert.equal((await stat(join(home,'agent-connection.json'))).mode&0o777,0o600);
  const pools=await client.callTool({name:'list_pools',arguments:{}});assert.ok(!pools.isError);assert.match(JSON.stringify(pools),/Alice pool/);
  const first=await connectedClient(home),binding=first.binding;await expire(home);const before=f.count();
  const results=await Promise.all(Array.from({length:5},async()=>(await connectedClient(home)).pools()));assert.ok(results.every(p=>p.length===1));assert.equal(f.count()-before,1);assert.equal((await connectedClient(home)).binding,binding);
  await expire(home);const crossBefore=f.count();
  const child=`import {connectedClient} from './src/team-cli.ts'; const c=await connectedClient(process.argv[1]); await c.pools();`;
  await Promise.all(Array.from({length:3},()=>promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',child,home],{cwd:process.cwd()})));
  assert.equal(f.count()-crossBefore,1);
  const broken=await readAgentConnection(home);broken!.tokens.access_token='rejected-access';await writeFile(join(home,'agent-connection.json'),JSON.stringify(broken));
  assert.equal((await (await connectedClient(home)).pools()).length,1);
  const second=await beginBrowserConnection(other,f.url,'Agent two');await f.approve(second);await second.done;
  await disconnectAgent(home);assert.equal((await connectionStatus(home)).status,'sign_in_required');assert.equal((await (await connectedClient(other)).pools()).length,1);
  const failed=await client.callTool({name:'list_pools',arguments:{}});assert.ok(failed.isError);assert.match(JSON.stringify(failed),/SIGN_IN_REQUIRED/);
  const again=await beginBrowserConnection(home,f.url,'Agent one');await f.approve(again);await again.done;
  assert.ok(!(await client.callTool({name:'list_pools',arguments:{}})).isError);
  const switchAccount=await beginBrowserConnection(home,f.url,'Agent one');await f.approve(switchAccount,'bob');await switchAccount.done;
  assert.notEqual((await connectedClient(home)).binding,binding);await assert.rejects(first.pools(),SignInRequired);
 }finally{await client.close();await mcp.close();await f.close();}
});

test('uncertain refresh is never replayed and browser consent rejects account switches',async()=>{
 const f=await fixture(),home=join(f.root,'home');try{
  const flow=await beginBrowserConnection(home,f.url);await f.approve(flow);await flow.done;
  const state=await expire(home);state.refreshAttempted=true;await writeFile(join(home,'agent-connection.json'),JSON.stringify(state));const before=f.count();
  await assert.rejects((await connectedClient(home)).pools(),SignInRequired);assert.equal(f.count(),before);
  const other=await beginBrowserConnection(join(f.root,'other'),f.url,undefined,{timeoutMs:200});
  const response=await fetch(other.url,{headers:{Cookie:'actor=alice'}}),html=await response.text(),nonce=html.match(/name="nonce" value="([^"]+)"/)![1];
  const denied=await fetch(f.url+'/connector/consent',{method:'POST',headers:{Origin:f.url,Cookie:response.headers.get('set-cookie')!.split(';')[0]+'; actor=bob','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({nonce,decision:'approve'})});assert.equal(denied.status,400);await assert.rejects(other.done,SignInRequired);
  assert.equal((await readAgentConnection(home))!.refreshAttempted,true);
 }finally{await f.close();}
});


test('legacy queues migrate only after both credentials prove the same account',async()=>{
 const f=await fixture();try{
  for(const actor of ['alice','bob']){
   const home=join(f.root,actor);await import('node:fs/promises').then(fs=>fs.mkdir(home));
   await writeFile(join(home,'team-connection.json'),JSON.stringify({url:f.url,token:f.alice.token}));
   const old=new TeamClient(f.url,f.alice.token),pool=f.store.listPools(f.alice.user.id)[0].id;
   const memory=makeMemory({text:'Queued before OAuth',source:'manual',session:actor,role:'user',timestamp:'',locator:'fixture',project:''});
   let queue=new ContributionQueue(home,old.binding);queue.enqueue(memory,{destination:'shared',pool});queue.close();
   const flow=await beginBrowserConnection(home,f.url);await f.approve(flow,actor);await flow.done;
   const client=await connectedClient(home);assert.equal(client.legacyBindings.includes(old.binding),actor==='alice');
   queue=new ContributionQueue(home,client.binding,client.legacyBindings);
   try{const result=await queue.flush((p,memories,context,provenance)=>client.putMemories(p,memories,provenance,context),async p=>({destination:'shared',pool:p}));assert.equal(result.sent,actor==='alice'?1:0);assert.equal(result.held,actor==='alice'?0:1);}finally{queue.close();}
   if(actor==='bob')await assert.rejects(client.memories(pool));
  }
 }finally{await f.close();}
});

test('lost refresh response preserves uncertainty and never replays a consumed token',async t=>{
 const f=await fixture(),home=join(f.root,'lost');try{
  const flow=await beginBrowserConnection(home,f.url);await f.approve(flow);await flow.done;await expire(home);
  const realFetch=globalThis.fetch;let refreshes=0;
  t.mock.method(globalThis,'fetch',async(input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
   const response=await realFetch(input,init);
   if(String(input)===f.url+'/token'&&String(init?.body).includes('grant_type=refresh_token')){refreshes++;await response.text();throw Error('Simulated lost reply');}
   return response;
  });
  await assert.rejects((await connectedClient(home)).pools(),SignInRequired);
  await assert.rejects((await connectedClient(home)).pools(),SignInRequired);
  assert.equal(refreshes,1);assert.equal((await readAgentConnection(home))!.refreshAttempted,true);
 }finally{t.mock.restoreAll();await f.close();}
});
