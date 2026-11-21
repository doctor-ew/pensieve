import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import type {Response} from 'express';
import {ConnectorAuth} from '../src/connector-auth.js';
import {PgConnectorStorage} from '../src/connector-storage.js';
import {TeamStore} from '../src/team-store.js';
import type {TeamRepository} from '../src/repositories.js';
import {refreshContract} from './connector-refresh-contract.js';

const connectionString=process.env.PENSIEVE_TEST_DATABASE_URL;
test('PostgreSQL refresh storage conformance',{skip:!connectionString},async t=>{
 const admin=new Pool({connectionString}),schema='refresh_'+randomBytes(8).toString('hex');await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema},public`});let calls=0;
 let beforeQuery:((sql:string)=>void)|undefined,afterQuery:((sql:string)=>Promise<void>)|undefined;
 pool.on('connect',client=>{const query=client.query.bind(client);client.query=((...args:unknown[])=>{calls++;const sql=String(args[0]);beforeQuery?.(sql);const result=(query as (...a:unknown[])=>unknown)(...args);if(afterQuery&&result instanceof Promise)return result.then(async value=>{await afterQuery?.(sql);return value;});return result;}) as typeof client.query;});
 try{
  for(const name of ['003-connector.sql','004-connector-refresh.sql'])await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const dump=async()=>{const rows=[];for(const table of ['connector_clients','connector_pending','connector_codes','connector_tokens','connector_families','connector_refresh','connector_revocations'])rows.push((await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);return JSON.stringify(rows);};
  await refreshContract(t,new PgConnectorStorage(pool),{now:Date.now()},dump,()=>({calls,items:0}),async(auth,issue)=>{
   for(const rotationFirst of [true,false]){
    const f=await issue();let entered!:()=>void,release!:()=>void,waiting!:()=>void;const locked=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;}),attempted=new Promise<void>(r=>{waiting=r;});
    const rotationLock='SELECT body,expires FROM connector_families',revokeLock='SELECT digest FROM connector_families';
    afterQuery=async sql=>{if(sql.startsWith(rotationFirst?rotationLock:revokeLock)){entered();await hold;}};
    beforeQuery=sql=>{if(sql.startsWith(rotationFirst?revokeLock:rotationLock))waiting();};
    const first=rotationFirst?auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!):auth.revokeToken(f.client,{token:f.tokens.refresh_token!});
    await locked;let finished=false;const second=(rotationFirst?auth.revokeToken(f.client,{token:f.tokens.access_token}):auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!)).then(value=>{finished=true;return value;},error=>{finished=true;throw error;});
    const settled=Promise.allSettled([first,second]);await attempted;await pool.query('SELECT 1');assert.equal(finished,false);
    afterQuery=undefined;beforeQuery=undefined;release();const results=await settled;
    assert.equal(results[rotationFirst?0:1].status,rotationFirst?'fulfilled':'rejected');
    for(const r of results)if(r.status==='fulfilled'&&r.value){await assert.rejects(auth.verifyAccessToken(r.value.access_token));await assert.rejects(auth.exchangeRefreshToken(f.client,r.value.refresh_token!));}
    await assert.rejects(auth.verifyAccessToken(f.tokens.access_token));await assert.rejects(auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!));
   }
   const f=await issue();let entered!:()=>void,release!:()=>void,attempted!:()=>void;const locked=new Promise<void>(r=>{entered=r;}),hold=new Promise<void>(r=>{release=r;}),registering=new Promise<void>(r=>{attempted=r;});
   afterQuery=async sql=>{if(sql.startsWith('UPDATE connector_families')){entered();await hold;}};
   beforeQuery=sql=>{if(sql.startsWith('LOCK TABLE connector_clients'))attempted();};
   const rotation=auth.exchangeRefreshToken(f.client,f.tokens.refresh_token!);await locked;
   const registration=auth.clientsStore.registerClient!({redirect_uris:['https://admission.example/callback'],token_endpoint_auth_method:'none'});await registering;await pool.query('SELECT 1');afterQuery=undefined;beforeQuery=undefined;release();
   const [tokens,client]=await Promise.all([rotation,registration]);assert.ok(client.client_id);await auth.verifyAccessToken(tokens.access_token);
  });
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
// AC8: real PostgreSQL storage, asynchronous identity lookup, restart and concurrent replay.
test('AC8 PostgreSQL connector survives restart and atomically consumes grants',{skip:!connectionString},async()=>{
 const admin=new Pool({connectionString});const schema='connector_test_'+randomBytes(8).toString('hex');
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString,options:`-c search_path=${schema},public`});
 const team=new TeamStore(':memory:');const alice=team.createUser('Alice');
 const asyncTeam=new Proxy(team,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?async(...args:unknown[])=>{await Promise.resolve();return value.apply(target,args);}:value;}}) as unknown as TeamRepository;
 const url=new URL('https://connector.example.com');const verifier='x'.repeat(64),challenge=createHash('sha256').update(verifier).digest('base64url');
 try{
  await pool.query(await readFile(new URL('../migrations/003-connector.sql',import.meta.url),'utf8'));
  await pool.query(await readFile(new URL('../migrations/004-connector-refresh.sql',import.meta.url),'utf8'));
  let auth=new ConnectorAuth(asyncTeam,url,':unused:',undefined,new PgConnectorStorage(pool));
  const client=await auth.clientsStore.registerClient!({redirect_uris:['https://client.example.com/callback'],token_endpoint_auth_method:'none',client_name:'PG fixture',grant_types:['authorization_code'],response_types:['code']});
  let html='';const response={cookie(){return this;},setHeader(){return this;},type(){return this;},send(body:string){html=body;return this;}} as unknown as Response;
  await auth.authorize(client,{redirectUri:client.redirect_uris[0],codeChallenge:challenge,scopes:['memories'],resource:new URL('/mcp',url),state:'state'},response);
  const nonce=html.match(/name="nonce" value="([^"]+)"/)![1];
  await assert.rejects(auth.consent(nonce,nonce,'wrong','approve'));
  const consents=await Promise.allSettled([auth.consent(nonce,nonce,alice.token,'approve'),auth.consent(nonce,nonce,alice.token,'approve')]);
  assert.equal(consents.filter(x=>x.status==='fulfilled').length,1);
  const approved=consents.find(x=>x.status==='fulfilled');assert.ok(approved?.status==='fulfilled');
  const code=new URL(approved.value).searchParams.get('code')!;
  auth.close();auth=new ConnectorAuth(asyncTeam,url,':unused:',undefined,new PgConnectorStorage(pool));
  assert.equal((await auth.clientsStore.getClient(client.client_id))?.client_name,'PG fixture');
  await assert.rejects(auth.exchangeAuthorizationCode(client,code,'bad',client.redirect_uris[0],new URL('/mcp',url)));
  await assert.rejects(auth.exchangeAuthorizationCode(client,code,verifier,client.redirect_uris[0],new URL('/wrong',url)));
  const exchanges=await Promise.allSettled([auth.exchangeAuthorizationCode(client,code,verifier,client.redirect_uris[0],new URL('/mcp',url)),auth.exchangeAuthorizationCode(client,code,verifier,client.redirect_uris[0],new URL('/mcp',url))]);
  assert.equal(exchanges.filter(x=>x.status==='fulfilled').length,1);
  const issued=exchanges.find(x=>x.status==='fulfilled');assert.ok(issued?.status==='fulfilled');const token=issued.value.access_token;
  auth.close();auth=new ConnectorAuth(asyncTeam,url,':unused:',undefined,new PgConnectorStorage(pool));
  assert.equal((await auth.verifyAccessToken(token)).extra?.actorId,alice.user.id);
  const stored=JSON.stringify((await pool.query('SELECT * FROM connector_tokens')).rows);
  assert.ok(!stored.includes(token));assert.ok(!stored.includes(alice.token));assert.equal((await pool.query('SELECT * FROM connector_codes')).rowCount,0);
  const stranger=await auth.clientsStore.registerClient!({redirect_uris:['https://client.example.com/other'],token_endpoint_auth_method:'none'});
  await auth.revokeToken(stranger,{token});await auth.verifyAccessToken(token);
  team.revokeUser(alice.user.id);await assert.rejects(auth.verifyAccessToken(token));
  await auth.revokeToken(client,{token});assert.equal((await pool.query('SELECT * FROM connector_tokens')).rowCount,0);
  auth.close();await pool.query('SELECT 1'); // shared application pool stays open
 }finally{team.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
