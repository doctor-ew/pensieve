import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {Response} from 'express';
import {ConnectorAuth} from '../src/connector-auth.js';
import type {ConnectorStorage,ConnectorEntry} from '../src/connector-storage.js';
import {TeamStore} from '../src/team-store.js';
import type {OAuthClientInformationFull,OAuthTokens} from '@modelcontextprotocol/sdk/shared/auth.js';

export async function refreshContract(t:TestContext,storage:ConnectorStorage,clock:{now:number},dump:()=>Promise<string>,metrics:()=>{calls:number;items:number},locks?:(auth:ConnectorAuth,issue:()=>Promise<{client:OAuthClientInformationFull;tokens:OAuthTokens}>)=>Promise<void>){
 const team=new TeamStore(':memory:');
 let fault:ConnectorEntry|undefined;
 let barrier:{count:number;wait:Promise<void>;release:()=>void}|undefined;
 const wrapped=new Proxy(storage,{get(target,key){
  if(key==='transact')return async(...args:Parameters<ConnectorStorage['transact']>)=>{
   if(barrier&&args[0].some(c=>c.table==='connector_families')){const b=barrier;if(++b.count===2)b.release();await b.wait;}
   if(fault)args[1]=[...args[1],fault];
   return target.transact(...args);
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 const url=new URL('https://connector.example.com'),verifier='v'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
 let auth=new ConnectorAuth(team,url,':unused:',()=>clock.now,wrapped);
 const prepare=async()=>{
  const user=team.createUser('Refresh fixture');
  const client=await auth.clientsStore.registerClient!({redirect_uris:['https://client.example.com/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']});
  let html='';const response={cookie(){return this;},setHeader(){return this;},type(){return this;},send(body:string){html=body;return this;}} as unknown as Response;
  await auth.authorize(client,{redirectUri:client.redirect_uris[0],codeChallenge:challenge,scopes:['memories'],resource:new URL('/mcp',url)},response);
  const nonce=html.match(/name="nonce" value="([^"]+)"/)![1];const location=await auth.consent(nonce,nonce,user.token,'approve');
  const code=new URL(location).searchParams.get('code')!;
  const exchange=()=>auth.exchangeAuthorizationCode(client,code,verifier,client.redirect_uris[0],new URL('/mcp',url));
  return {client,user,code,exchange};
 };
 const issue=async()=>{const prepared=await prepare();const tokens=await prepared.exchange();assert.equal(typeof tokens.refresh_token,'string');return {...prepared,tokens};};
 try{
  await t.test('issuance and rotation roll back every record on a late write failure',async()=>{
   const prepared=await prepare();fault={table:'connector_tokens',key:randomUUID(),row:{body:JSON.stringify({clientId:prepared.client.client_id,refreshEnabled:true}),expires:clock.now+3600000}};await storage.insert(fault);
   const before=await dump();await assert.rejects(prepared.exchange());assert.equal(await dump(),before);fault=undefined;
   const tokens=await prepared.exchange();fault={table:'connector_tokens',key:randomUUID(),row:{body:JSON.stringify({clientId:prepared.client.client_id,refreshEnabled:true}),expires:clock.now+3600000}};await storage.insert(fault);
   const previous=await dump();await assert.rejects(auth.exchangeRefreshToken(prepared.client,tokens.refresh_token!));assert.equal(await dump(),previous);await auth.verifyAccessToken(tokens.access_token);
   fault=undefined;await auth.exchangeRefreshToken(prepared.client,tokens.refresh_token!);
  });
  await t.test('forced overlapping refresh has one winner and replay revokes the winner',async()=>{
   const f=await issue();let release!:()=>void;barrier={count:0,wait:new Promise<void>(resolve=>{release=resolve;}),release:()=>release()};
   const results=await Promise.allSettled([auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!),auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!)]);barrier=undefined;
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const failed=results.find(r=>r.status==='rejected');assert.equal(failed?.status==='rejected'&&(failed.reason as {errorCode:string}).errorCode,'invalid_grant');
   for(const r of results)if(r.status==='fulfilled'){await assert.rejects(auth.verifyAccessToken(r.value.access_token));await assert.rejects(auth.exchangeRefreshToken(f.client,r.value.refresh_token!));}
  });
  await t.test('revocation wins before rotation commit and also invalidates an already rotated pair',async()=>{
   const f=await issue();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});const hold=new Promise<void>(resolve=>{release=resolve;});
   const rotate=storage.transact.bind(storage);storage.transact=async(...args)=>{entered();await hold;return rotate(...args);};
   try{const pending=auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!);await ready;await auth.revokeToken(f.client,{token:f.tokens.access_token});release();await assert.rejects(pending);}finally{release();storage.transact=rotate;}
   const g=await issue(),next=await auth.exchangeRefreshToken(g.client,g.tokens.refresh_token!);await auth.revokeToken(g.client,{token:g.tokens.refresh_token!});await assert.rejects(auth.verifyAccessToken(next.access_token));await assert.rejects(auth.exchangeRefreshToken(g.client,next.refresh_token!));
  });
  if(locks)await t.test('adapter-specific in-flight contention regression',()=>locks(auth,issue));
  await t.test('wrong client/resource/scope and unknown revocation preserve the owning family',async()=>{
   const a=await issue(),b=await issue(),before=await dump();
   await assert.rejects(auth.exchangeRefreshToken(b.client,a.tokens.refresh_token!));await assert.rejects(auth.exchangeRefreshToken(a.client,a.tokens.refresh_token!,undefined,new URL('https://other.example/mcp')));
   await assert.rejects(auth.exchangeRefreshToken(a.client,a.tokens.refresh_token!,['admin']),{errorCode:'invalid_scope'});
   for(const token of [a.tokens.access_token,a.tokens.refresh_token!,'unknown'])await auth.revokeToken(b.client,{token});
   assert.equal(await dump(),before);await auth.verifyAccessToken(a.tokens.access_token);
   const narrowed=await auth.exchangeRefreshToken(a.client,a.tokens.refresh_token!,[]),next=await auth.exchangeRefreshToken(a.client,narrowed.refresh_token!);assert.equal(next.scope,'');assert.deepEqual((await auth.verifyAccessToken(next.access_token)).scopes,[]);
   await assert.rejects(auth.exchangeRefreshToken(a.client,next.refresh_token!,['memories']),{errorCode:'invalid_scope'});team.revokeUser(a.user.user.id);await assert.rejects(auth.exchangeRefreshToken(a.client,next.refresh_token!));
  });
  await t.test('inactivity and access deadlines reject exactly at expiry',async()=>{
   const f=await issue();clock.now+=3599999;await auth.verifyAccessToken(f.tokens.access_token);clock.now++;await assert.rejects(auth.verifyAccessToken(f.tokens.access_token));
   const a=await issue(),b=await issue(),c=await issue();clock.now+=7*86400000-1;await auth.exchangeRefreshToken(a.client,a.tokens.refresh_token!);clock.now++;await assert.rejects(auth.exchangeRefreshToken(b.client,b.tokens.refresh_token!));clock.now++;await assert.rejects(auth.exchangeRefreshToken(c.client,c.tokens.refresh_token!));
   const reset=await issue();clock.now+=6*86400000;const renewed=await auth.exchangeRefreshToken(reset.client,reset.tokens.refresh_token!);clock.now+=7*86400000-1;await auth.exchangeRefreshToken(reset.client,renewed.refresh_token!);
  });
  await t.test('cleanup retains clients until absolute expiry and capped expires_in rounds down',async()=>{
   const f=await issue(),start=clock.now;let tokens=f.tokens;
   for(let n=0;n<4;n++){clock.now+=6*86400000;tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);}
   clock.now=start+29*86400000;await storage.prune(clock.now);await auth.clientsStore.registerClient!({redirect_uris:['https://new.example/callback'],token_endpoint_auth_method:'none'});assert.ok(await auth.clientsStore.getClient(f.client.client_id));
   tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);clock.now=start+30*86400000-1500;tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);assert.equal(tokens.expires_in,1);
   clock.now+=1499;await auth.verifyAccessToken(tokens.access_token);clock.now++;await assert.rejects(auth.verifyAccessToken(tokens.access_token));await assert.rejects(auth.exchangeRefreshToken(f.client,tokens.refresh_token!));clock.now++;await assert.rejects(auth.exchangeRefreshToken(f.client,tokens.refresh_token!));
  });
  await t.test('hash-only state survives provider reconstruction; operation counts stay constant',async()=>{
   const f=await issue();let tokens=f.tokens;const secrets=[f.user.token,f.code,verifier,tokens.access_token,tokens.refresh_token!];
   const delta=(a:ReturnType<typeof metrics>,b:ReturnType<typeof metrics>)=>({calls:b.calls-a.calls,items:b.items-a.items});
   let before=metrics();tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);const first=delta(before,metrics());secrets.push(tokens.access_token,tokens.refresh_token!);
   for(let n=0;n<24;n++){tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);secrets.push(tokens.access_token,tokens.refresh_token!);}
   before=metrics();tokens=await auth.exchangeRefreshToken(f.client,tokens.refresh_token!);assert.deepEqual(delta(before,metrics()),first);secrets.push(tokens.access_token,tokens.refresh_token!);
   auth=new ConnectorAuth(team,url,':unused:',()=>clock.now,wrapped);await auth.verifyAccessToken(tokens.access_token);const stored=await dump();for(const raw of secrets)assert.ok(!stored.includes(raw));
   const other=await issue();before=metrics();await auth.revokeToken(other.client,{token:other.tokens.refresh_token!});const revoke=delta(before,metrics());before=metrics();await auth.revokeToken(f.client,{token:tokens.refresh_token!});assert.deepEqual(delta(before,metrics()),revoke);
   await assert.rejects(auth.verifyAccessToken(tokens.access_token));
  });
 }finally{team.close();}
}
