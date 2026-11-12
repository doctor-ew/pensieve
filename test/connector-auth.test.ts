import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type {OAuthClientInformationFull} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Express } from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAgentServer, createConnectorApp } from '../src/agent-server.js';
import { ConnectorAuth } from '../src/connector-auth.js';
import { TeamStore } from '../src/team-store.js';
import {SqliteConnectorStorage} from '../src/connector-storage.js';
import {refreshContract} from './connector-refresh-contract.js';
import { createTeamServer } from '../src/team-server.js';

const verifier='a'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
test('SQLite refresh storage conformance',async t=>{
 const storage=new SqliteConnectorStorage(':memory:'),db=(storage as unknown as {db:DatabaseSync}).db,clock={now:Date.now()};let calls=0;
 const prepare=db.prepare.bind(db);db.prepare=((sql:string)=>{calls++;return prepare(sql);}) as typeof db.prepare;
 const dump=async()=>JSON.stringify(['connector_clients','connector_pending','connector_codes','connector_tokens','connector_families','connector_refresh','connector_revocations'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()));
 try{await refreshContract(t,storage,clock,dump,()=>({calls,items:0}));}finally{storage.close();}
});
async function fixture(browserSession=false) {
  const dir=await mkdtemp(join(tmpdir(),'pensieve-connector-'));const statePath=join(dir,'oauth.sqlite');
  const store=new TeamStore(':memory:');const alice=store.createUser('Alice'),bob=store.createUser('Bob');
  const pool=store.createPool(alice.user.id,'Alice private','private');
  let app:Express; const http=createServer((req,res)=>app(req,res));http.listen(0,'127.0.0.1');await once(http,'listening');
  const url=`http://127.0.0.1:${(http.address() as {port:number}).port}`;let clock=Date.now();
  const provider={identity:'test-v1',embed:async(texts:string[])=>texts.map(()=>[1,0,0])};
  const connector=createConnectorApp(store,{publicUrl:url,statePath,provider,sessionUser:browserSession?async cookie=>cookie?.includes('appfixture=verified')?alice.user:undefined:undefined,now:()=>clock});app=connector.app;
  const teamServer=createTeamServer(store,{publicUrl:url,ownerToken:'o'.repeat(40),provider});app.use((req,res)=>{teamServer.emit('request',req,res);});
  const form=(path:string,body:Record<string,string>,headers:Record<string,string>={})=>fetch(url+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
  const register=async(extra:Record<string,unknown>={})=>{
    const response=await fetch(url+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Fixture client',redirect_uris:['http://127.0.0.1:9811/callback'],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none',...extra})});
    assert.equal(response.status,201,await response.clone().text());return await response.json() as OAuthClientInformationFull;
  };
  const begin=async(clientId:string,extra:Record<string,string>={})=>{
    const params=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:'http://127.0.0.1:9811/callback',code_challenge:challenge,code_challenge_method:'S256',scope:'memories',resource:url+'/mcp',state:'safe-state',...extra});
    const response=await fetch(url+'/authorize?'+params,{redirect:'manual'});const body=await response.text();
    return {response,body,nonce:body.match(/name="nonce" value="([^"]+)"/)?.[1]??'',cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
  };
  const code=async(clientId:string,credential=alice.token)=>{const pending=await begin(clientId);assert.equal(pending.response.status,200);const response=await form('/connector/consent',{nonce:pending.nonce,credential,decision:'approve'},{Origin:url,Cookie:pending.cookie});assert.equal(response.status,302,await response.clone().text());return new URL(response.headers.get('location')!).searchParams.get('code')!;};
  const exchange=(clientId:string,code:string,extra:Record<string,string>={})=>form('/token',{grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:'http://127.0.0.1:9811/callback',resource:url+'/mcp',...extra});
  const token=async(clientId:string,credential=alice.token)=>{const response=await exchange(clientId,await code(clientId,credential));assert.equal(response.status,200,await response.clone().text());return (await response.json() as {access_token:string}).access_token;};
  return {dir,store,alice,bob,pool,url,statePath,provider,connector,register,begin,code,token,form,exchange,advance:(ms:number)=>clock+=ms,close:async()=>{http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));connector.close();store.close();await rm(dir,{recursive:true,force:true});}};
}

test('registration preserves supported refresh grants and issues one-hour access tokens',async()=>{
 const f=await fixture();try{
  const client=await f.register({grant_types:['authorization_code','refresh_token']});
  assert.deepEqual(client.grant_types,['authorization_code','refresh_token']);
  assert.deepEqual((await f.connector.auth.clientsStore.getClient(client.client_id))?.grant_types,['authorization_code','refresh_token']);
  const consent=await f.begin(client.client_id);assert.equal(consent.response.headers.get('referrer-policy'),'same-origin');assert.equal(consent.response.headers.get('content-security-policy'),"default-src 'none'; form-action 'self' http://127.0.0.1:9811; frame-ancestors 'none'; base-uri 'none'");
  const response=await f.exchange(client.client_id,await f.code(client.client_id));
  assert.equal(response.status,200);const tokens=await response.json();
  assert.equal(tokens.expires_in,3600);assert.equal(typeof tokens.refresh_token,'string');
  const invalid=await fetch(f.url+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://localhost:53682/callback'],token_endpoint_auth_method:'none',grant_types:['client_credentials'],response_types:['code']})});
  assert.equal(invalid.status,400);
 }finally{await f.close();}
});

async function renewable(f:Awaited<ReturnType<typeof fixture>>) {
 const client=await f.register({grant_types:['authorization_code','refresh_token']});
 const response=await f.exchange(client.client_id,await f.code(client.client_id));
 assert.equal(response.status,200);const tokens=await response.json();
 assert.equal(typeof tokens.refresh_token,'string');
 return {client,tokens};
}
test('refresh rotates opaque credentials, preserves restart state, and rejects owner replay',async()=>{
 const f=await fixture();try{
  const {client,tokens}=await renewable(f);
  const response=await f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token});
  assert.equal(response.status,200);const next=await response.json();
  assert.notEqual(next.refresh_token,tokens.refresh_token);assert.notEqual(next.access_token,tokens.access_token);assert.equal(next.expires_in,3600);
  await assert.rejects(f.connector.auth.verifyAccessToken(tokens.access_token));
  const second=new ConnectorAuth(f.store,new URL(f.url),f.statePath);try{assert.equal((await second.verifyAccessToken(next.access_token)).extra?.actorId,f.alice.user.id);}finally{second.close();}
  const db=new DatabaseSync(f.statePath);try{const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'connector_%'").all();for(const {name} of rows){const stored=JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all());for(const raw of [tokens.access_token,tokens.refresh_token,next.access_token,next.refresh_token,f.alice.token])assert.ok(!stored.includes(raw));}}finally{db.close();}
  assert.equal((await f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token})).status,400);
  await assert.rejects(f.connector.auth.verifyAccessToken(next.access_token));
  await assert.rejects(f.connector.auth.exchangeRefreshToken(client,next.refresh_token));
 }finally{await f.close();}
});
test('refresh binds client/resource, preserves narrowing, and enforces actor liveness',async()=>{
 const f=await fixture();try{
  const {client,tokens}=await renewable(f),other=await f.register({grant_types:['authorization_code','refresh_token']});
  const request=(extra:Record<string,string>={})=>f.form('/token',{grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,...extra});
  for(const extra of [{client_id:other.client_id},{resource:f.url+'/other'},{scope:'admin'}])assert.equal((await request(extra)).status,400);
  for(const token of [tokens.access_token,tokens.refresh_token,'unknown'])assert.equal((await f.form('/revoke',{client_id:other.client_id,token})).status,200);
  await f.connector.auth.verifyAccessToken(tokens.access_token);
  const narrowed=await f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token,[]);assert.equal(narrowed.scope,'');
  const next=await f.connector.auth.exchangeRefreshToken(client,narrowed.refresh_token!);assert.equal(next.scope,'');
  assert.deepEqual((await f.connector.auth.verifyAccessToken(next.access_token)).scopes,[]);
  assert.equal((await fetch(f.url+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+next.access_token,'Content-Type':'application/json'},body:'{}'})).status,403);
  await assert.rejects(f.connector.auth.exchangeRefreshToken(client,next.refresh_token!,['memories']));
  f.store.revokeUser(f.alice.user.id);await assert.rejects(f.connector.auth.exchangeRefreshToken(client,next.refresh_token!));
 }finally{await f.close();}
});
test('refresh expiry boundaries, cleanup retention and absolute cap are enforced',async()=>{
 const day=86400000;
 const f=await fixture();try{
  let {client,tokens}=await renewable(f);
  f.advance(6*day);tokens=await f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token);
  for(let dayNumber=12;dayNumber<=24;dayNumber+=6){f.advance(6*day);tokens=await f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token);}
  f.advance(5*day);await f.register();assert.ok(await f.connector.auth.clientsStore.getClient(client.client_id));
  f.advance(day-1500);tokens=await f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token);assert.equal(tokens.expires_in,1);
  f.advance(1499);await f.connector.auth.verifyAccessToken(tokens.access_token);f.advance(1);await assert.rejects(f.connector.auth.verifyAccessToken(tokens.access_token));await assert.rejects(f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token));
 }finally{await f.close();}
 const g=await fixture();try{const {client,tokens}=await renewable(g);g.advance(7*day);await assert.rejects(g.connector.auth.exchangeRefreshToken(client,tokens.refresh_token));}finally{await g.close();}
});
test('overlapping refresh and disconnect cannot leave a revived family',async()=>{
 const f=await fixture();try{
  const {client,tokens}=await renewable(f);
  const results=await Promise.allSettled([f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token),f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  for(const r of results)if(r.status==='fulfilled'){await assert.rejects(f.connector.auth.verifyAccessToken(r.value.access_token));await assert.rejects(f.connector.auth.exchangeRefreshToken(client,r.value.refresh_token!));}
  for(const useRefresh of [false,true]){const fresh=await renewable(f);const raced=await Promise.allSettled([f.connector.auth.exchangeRefreshToken(fresh.client,fresh.tokens.refresh_token),f.connector.auth.revokeToken(fresh.client,{token:useRefresh?fresh.tokens.refresh_token:fresh.tokens.access_token})]);for(const r of raced)if(r.status==='fulfilled'&&r.value){await assert.rejects(f.connector.auth.verifyAccessToken(r.value.access_token));await assert.rejects(f.connector.auth.exchangeRefreshToken(fresh.client,r.value.refresh_token!));}}
 }finally{await f.close();}
});
test('SQLite late-write failures roll back initial issuance and refresh rotation',async()=>{
 const f=await fixture();const db=new DatabaseSync(f.statePath);try{
  const client=await f.register({grant_types:['authorization_code','refresh_token']}),code=await f.code(client.client_id);
  db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON connector_tokens BEGIN SELECT RAISE(ABORT, 'injected token write failure'); END");
  await assert.rejects(f.connector.auth.exchangeAuthorizationCode(client,code,verifier,'http://127.0.0.1:9811/callback',new URL(f.url+'/mcp')));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connector_tokens').get()!.n,0);
  db.exec('DROP TRIGGER fail_token');const response=await f.exchange(client.client_id,code);assert.equal(response.status,200);const tokens=await response.json();assert.equal(typeof tokens.refresh_token,'string');
  const before=JSON.stringify(db.prepare('SELECT * FROM connector_tokens').all());
  db.exec("CREATE TRIGGER fail_token BEFORE INSERT ON connector_tokens BEGIN SELECT RAISE(ABORT, 'injected token write failure'); END");
  await assert.rejects(f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token));assert.equal(JSON.stringify(db.prepare('SELECT * FROM connector_tokens').all()),before);await f.connector.auth.verifyAccessToken(tokens.access_token);
  db.exec('DROP TRIGGER fail_token');await f.connector.auth.exchangeRefreshToken(client,tokens.refresh_token);
 }finally{db.close();await f.close();}
});

test('Chromium consent preserves same-origin POST and follows the registered callback',async()=>{
 const f=await fixture();
 const callback=createServer((_req,res)=>res.end('Connected'));
 callback.listen(0,'127.0.0.1');await once(callback,'listening');
 const redirectUri=`http://127.0.0.1:${(callback.address() as {port:number}).port}/callback`;
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
 try{
  const client=await f.register({redirect_uris:[redirectUri]});
  const pending=await f.begin(client.client_id,{redirect_uri:redirectUri});
  assert.equal(pending.response.headers.get('referrer-policy'),'same-origin');
  assert.equal(pending.response.headers.get('content-security-policy'),`default-src 'none'; form-action 'self' ${new URL(redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`);
  const page=await browser.newPage();
  const params=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:redirectUri,code_challenge:challenge,code_challenge_method:'S256',scope:'memories',resource:f.url+'/mcp',state:'browser-state'});
  await page.goto(f.url+'/authorize?'+params);
  await page.locator('input[name="credential"]').fill(f.alice.token);
  const posted=page.waitForRequest(request=>request.url()===f.url+'/connector/consent');
  await page.getByRole('button',{name:'Allow connection'}).click();
  await page.waitForURL(url=>url.origin===new URL(redirectUri).origin);
  assert.equal((await posted).headers().origin,f.url);
  assert.ok(new URL(page.url()).searchParams.get('code'));
  assert.equal(new URL(page.url()).searchParams.get('state'),'browser-state');
 }finally{await browser.close();callback.closeAllConnections();await new Promise<void>(resolve=>callback.close(()=>resolve()));await f.close();}
});

test('AC8 OAuth metadata, consent, PKCE, exact redirect/resource/client bindings and one-use codes',async()=>{
 const f=await fixture();try {
  const metadata=await (await fetch(f.url+'/.well-known/oauth-authorization-server')).json() as {grant_types_supported:string[]};assert.deepEqual(metadata.grant_types_supported,['authorization_code','refresh_token']);
  const resource=await (await fetch(f.url+'/.well-known/oauth-protected-resource/mcp')).json() as {resource:string};assert.equal(resource.resource,f.url+'/mcp');
  const a=await f.register(),b=await f.register();const code=await f.code(a.client_id);
  for(const [client,extra] of [[a.client_id,{code_verifier:'b'.repeat(64)}],[b.client_id,{}],[a.client_id,{redirect_uri:'http://127.0.0.1:9811/other'}],[a.client_id,{resource:f.url+'/other'}]] as [string,Record<string,string>][]) assert.equal((await f.exchange(client,code,extra)).status,400);
  const good=await f.exchange(a.client_id,code);assert.equal(good.status,200);assert.equal((await f.exchange(a.client_id,code)).status,400);
  const consent=await f.begin(a.client_id);assert.equal((await f.form('/connector/consent',{nonce:consent.nonce,credential:f.alice.token,decision:'approve'},{Origin:f.url})).status,400);
  assert.equal((await f.form('/connector/consent',{nonce:consent.nonce,credential:f.alice.token,decision:'approve'},{Origin:'https://foreign.invalid',Cookie:consent.cookie})).status,403);
  for(const headers of [{Cookie:consent.cookie},{Origin:'null',Cookie:consent.cookie,'Sec-Fetch-Site':'same-origin'}]) assert.equal((await f.form('/connector/consent',{nonce:consent.nonce,credential:f.alice.token,decision:'approve'},headers)).status,403);
  const denied=await f.form('/connector/consent',{nonce:consent.nonce,decision:'deny'},{Origin:f.url,Cookie:consent.cookie});assert.equal(new URL(denied.headers.get('location')!).searchParams.get('error'),'access_denied');
  assert.equal((await f.form('/connector/consent',{nonce:consent.nonce,credential:f.alice.token,decision:'approve'},{Origin:f.url,Cookie:consent.cookie})).status,400);
  assert.notEqual((await f.begin(a.client_id,{redirect_uri:'http://127.0.0.1:9812/callback'})).response.status,200);
  assert.notEqual((await f.begin(a.client_id,{resource:'https://foreign.invalid/mcp'})).response.status,200);
 }finally{await f.close();}
});

test('AC8 tokens survive restart as hashes, bind revocation to client, expire, and check creator liveness',async()=>{
 const f=await fixture();try{
  const a=await f.register(),b=await f.register();const token=await f.token(a.client_id);
  const second=new ConnectorAuth(f.store,new URL(f.url),f.statePath);assert.equal((await second.verifyAccessToken(token)).extra?.actorId,f.alice.user.id);second.close();
  const db=await readFile(f.statePath);assert.equal(db.includes(Buffer.from(token)),false);assert.equal(db.includes(Buffer.from(f.alice.token)),false);
  assert.equal((await f.form('/revoke',{client_id:b.client_id,token})).status,200);await f.connector.auth.verifyAccessToken(token);
  assert.equal((await f.form('/revoke',{client_id:a.client_id,token})).status,200);await assert.rejects(f.connector.auth.verifyAccessToken(token));
  const expiredCode=await f.code(a.client_id);f.advance(301000);assert.equal((await f.exchange(a.client_id,expiredCode)).status,400);
  const expiring=await f.token(a.client_id);f.advance(3600001);await assert.rejects(f.connector.auth.verifyAccessToken(expiring));
  const revoked=await f.token(a.client_id),revokedCode=await f.code(a.client_id);f.store.revokeUser(f.alice.user.id);await assert.rejects(f.connector.auth.verifyAccessToken(revoked));assert.equal((await f.exchange(a.client_id,revokedCode)).status,400);
 }finally{await f.close();}
});

test('AC8 official SDK HTTP client saves, recalls and exports only authorized data; policy and user isolation hold',async()=>{
 const f=await fixture();const clients:Client[]=[];try{
  const registration=await f.register();const access=await f.token(registration.client_id);
  const client=new Client({name:'fixture',version:'1'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(f.url+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${access}`}}}));
  const listed=await client.listTools();assert.equal(listed.tools.length,5);
  const saved=await client.callTool({name:'save_memory',arguments:{poolId:f.pool.id,text:'We chose local-first storage.',repository:'/fixture/repo',conversation:'fixture-session',synthetic:true}});assert.ok(!saved.isError);
  assert.ok(!(await client.callTool({name:'index_memories',arguments:{poolId:f.pool.id}})).isError);
  const recalled=await client.callTool({name:'recall_memories',arguments:{poolId:f.pool.id,query:'storage decision'}});assert.ok(JSON.stringify(recalled).includes('local-first'));
  const id=f.store.listMemories(f.alice.user.id,f.pool.id)[0].memory.id;
  const exported=await client.callTool({name:'prepare_share',arguments:{poolId:f.pool.id,ids:[id]}});assert.ok(JSON.stringify(exported).includes(id));assert.ok(!JSON.stringify(exported).includes(f.alice.token));
  f.store.setPolicy(f.alice.user.id,f.pool.id,'conversation','fixture-session',{destination:'off'});
  const blocked=await client.callTool({name:'save_memory',arguments:{poolId:f.pool.id,text:'must not save',conversation:'fixture-session'}});assert.equal(blocked.isError,true);assert.equal(f.store.listMemories(f.alice.user.id,f.pool.id).length,1);
  const bobAccess=await f.token(registration.client_id,f.bob.token);const bobClient=new Client({name:'bob',version:'1'});clients.push(bobClient);await bobClient.connect(new StreamableHTTPClientTransport(new URL(f.url+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${bobAccess}`}}}));
  for(const request of [{name:'index_memories',arguments:{poolId:f.pool.id}},{name:'save_memory',arguments:{poolId:f.pool.id,text:'evil'}},{name:'recall_memories',arguments:{poolId:f.pool.id,query:'storage'}},{name:'prepare_share',arguments:{poolId:f.pool.id,ids:[id]}}]) {const denied=await bobClient.callTool(request);assert.equal(denied.isError,true);assert.ok(!JSON.stringify(denied).includes('local-first'));}
  const malformed=await fetch(f.url+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${f.alice.token}`,'Content-Type':'application/json'},body:'{}'});assert.equal(malformed.status,401);
  const replay=await fetch(f.url+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${access}`,'mcp-session-id':'foreign-session','Content-Type':'application/json'},body:'{}'});assert.equal(replay.status,400);
  f.store.revokeUser(f.alice.user.id);await assert.rejects(client.listTools());
 }finally{await Promise.all(clients.map(c=>c.close()));await f.close();}
});

test('AC8 official SDK stdio-equivalent in-memory transport rechecks revoked actor on tool calls',async()=>{
 const store=new TeamStore(':memory:');const user=store.createUser('Local');store.createPool(user.user.id,'Private','private');
 const server=createAgentServer(store,user.user.id);const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(a);await client.connect(b);assert.ok(!(await client.callTool({name:'list_pools',arguments:{}})).isError);store.revokeUser(user.user.id);assert.equal((await client.callTool({name:'list_pools',arguments:{}})).isError,true);}
 finally{await client.close();await server.close();store.close();}
});


test('AC8 official SDK starts a real stdio subprocess without credentials on stdout',async()=>{
 const script=`import {TeamStore} from './src/team-store.ts'; import {connectStdio} from './src/agent-server.ts'; const store=new TeamStore(':memory:');const user=store.createUser('Stdio fixture');store.createPool(user.user.id,'Stdio private','private');await connectStdio(store,user.token);`;
 const client=new Client({name:'stdio-proof',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','--input-type=module','-e',script],cwd:process.cwd(),stderr:'pipe'});
 try{await client.connect(transport);const response=await client.callTool({name:'list_pools',arguments:{}});assert.ok(!response.isError);assert.ok(JSON.stringify(response).includes('Stdio private'));assert.equal((await client.listTools()).tools.length,5);}
 finally{await client.close();}
});


test('AC8 CLI mcp subprocess connects to remote team account and enforces isolation and revocation',async()=>{
 const f=await fixture();const clients:Client[]=[];
 const connect=async(token:string)=>{const client=new Client({name:'cli-proof',version:'1'});clients.push(client);await client.connect(new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/cli.ts','mcp','--home',f.dir],cwd:process.cwd(),env:{PENSIEVE_TEAM_URL:f.url,PENSIEVE_TEAM_TOKEN:token},stderr:'pipe'}));return client;};
 try {
  const alice=await connect(f.alice.token),bob=await connect(f.bob.token);
  const alicePools=await alice.callTool({name:'list_pools',arguments:{}});assert.ok(JSON.stringify(alicePools).includes(f.pool.id));
  const bobPools=await bob.callTool({name:'list_pools',arguments:{}});assert.ok(!JSON.stringify(bobPools).includes(f.pool.id));
  const saved=await alice.callTool({name:'save_memory',arguments:{poolId:f.pool.id,text:'Remote stdio decision',conversation:'remote-session',synthetic:true}});assert.ok(!saved.isError,JSON.stringify(saved));assert.equal(f.store.listMemories(f.alice.user.id,f.pool.id)[0].memory.synthetic,true);
  const denied=await bob.callTool({name:'save_memory',arguments:{poolId:f.pool.id,text:'Should not persist'}});assert.equal(denied.isError,true);
  assert.ok(!(await alice.callTool({name:'index_memories',arguments:{poolId:f.pool.id}})).isError);
  const recalled=await alice.callTool({name:'recall_memories',arguments:{poolId:f.pool.id,query:'decision'}});assert.ok(JSON.stringify(recalled).includes('Remote stdio decision'));
  f.store.revokeUser(f.alice.user.id);assert.equal((await alice.callTool({name:'list_pools',arguments:{}})).isError,true);
 }finally{await Promise.all(clients.map(c=>c.close()));await f.close();}
});

// AC8: trusted browser session supports Cognito creators without personal invitation tokens.
test('AC8 explicit connector consent uses server-resolved browser identity',async()=>{
 const f=await fixture(true);try{
  const client=await f.register(),pending=await f.begin(client.client_id);
  const denied=await f.form('/connector/consent',{nonce:pending.nonce,decision:'approve',actorId:f.alice.user.id},{Origin:f.url,Cookie:pending.cookie});assert.equal(denied.status,400);
  const approved=await f.form('/connector/consent',{nonce:pending.nonce,decision:'approve'},{Origin:f.url,Cookie:pending.cookie+'; appfixture=verified'});assert.equal(approved.status,302);
  const code=new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const exchanged=await f.exchange(client.client_id,code);assert.equal(exchanged.status,200);
  const access=await exchanged.json();assert.equal((await f.connector.auth.verifyAccessToken(access.access_token)).extra?.actorId,f.alice.user.id);
 }finally{await f.close();}
});
