import {chromium,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer as netServer} from 'node:net';
import {Pool} from 'pg';
import {migratePostgres} from '../src/postgres.js';
import {PgTeamStore} from '../src/pg-team-store.js';
import {PgShareStore} from '../src/pg-share-store.js';
import {PgDeliveryLedger} from '../src/pg-delivery.js';
import {PgHostedSessions,PgLoginStates} from '../src/hosted-sessions.js';
import {CognitoAuth} from '../src/cognito.js';
import {createTeamServer} from '../src/team-server.js';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {makeMemory} from '../src/sessions.js';

const connectionString=process.env.PENSIEVE_TEST_DATABASE_URL;
async function setup(){
 const admin=new Pool({connectionString});const schema='http_'+randomUUID().replaceAll('-','');await admin.query(`CREATE SCHEMA ${schema}`);
 const db=new Pool({connectionString,options:`-c search_path=${schema},public`});await migratePostgres(db);
 const store=await PgTeamStore.open(db),shares=new PgShareStore(db),sessions=new PgHostedSessions(db),delivery=new PgDeliveryLedger(db);
 const probe=netServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const addr=probe.address();assert.ok(addr&&typeof addr!=='string');await new Promise<void>(r=>probe.close(()=>r()));
 const base='http://127.0.0.1:'+addr.port;
 return{db,store,shares,sessions,delivery,base,port:addr.port,close:async()=>{await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
test('hosted HTTP persists sessions, paginates and shares only selected memories',{skip:!connectionString},async()=>{
 const f=await setup();let server=createTeamServer(f.store,{publicUrl:f.base,ownerToken:'x'.repeat(32),shareStore:f.shares,sessionStore:f.sessions,delivery:f.delivery});
 await new Promise<void>(r=>server.listen(f.port,'127.0.0.1',r));
 try{
  const alice=await f.store.createUser('Alice'),bob=await f.store.createUser('Bob');const pool=await f.store.createPool(alice.user.id,'Private','private');
  const memories=Array.from({length:61},(_,i)=>makeMemory({text:'Synthetic decision '+i,source:'manual',session:'fixture',role:'user',timestamp:'2026-11-07T00:00:00Z',locator:'fixture:'+i,project:'synthetic'}));await f.store.putMemories(alice.user.id,pool.id,memories);
  const login=await fetch(f.base+'/api/team/session',{method:'POST',headers:{Origin:f.base,'Content-Type':'application/json'},body:JSON.stringify({token:alice.token})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  await new Promise<void>(r=>server.close(()=>r()));
  server=createTeamServer(await PgTeamStore.open(f.db),{publicUrl:f.base,ownerToken:'x'.repeat(32),shareStore:new PgShareStore(f.db),sessionStore:new PgHostedSessions(f.db),delivery:new PgDeliveryLedger(f.db)});await new Promise<void>(r=>server.listen(f.port,'127.0.0.1',r));
  const request=(path:string,body?:unknown,token?:string)=>fetch(f.base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:f.base,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await request('/api/team/me')).status,200);
  const path='/api/team/pools/'+pool.id;const p1=await (await request(path+'/memories')).json();assert.equal(p1.memories.length,50);assert.ok(p1.nextCursor);const p2=await (await request(path+'/memories?cursor='+encodeURIComponent(p1.nextCursor))).json();assert.equal(p2.memories.length,11);assert.equal(new Set([...p1.memories,...p2.memories].map(x=>x.memory.id)).size,61);
  assert.equal((await request(path+'/memories',undefined,bob.token)).status,404);
  const response=await request(path+'/shares',{ids:[memories[0].id],title:'Selected',brief:'Reviewed synthetic decision',recipients:['reader@example.com'],days:1,accessMode:'invitation-link'});assert.equal(response.status,201);const share=await response.json();const token=new URL(share.invitations[0].url).hash.slice(1);
  const read=await fetch(f.base+'/api/reader/'+share.id,{headers:{Authorization:'Bearer '+token}});assert.equal(read.status,200);assert.equal((await read.json()).memories.length,1);
  await request(path+'/shares/'+share.id+'/revoke',{});assert.equal((await fetch(f.base+'/api/reader/'+share.id,{headers:{Authorization:'Bearer '+token}})).status,401);
  await request('/api/team/logout',{});assert.equal((await request('/api/team/me')).status,401);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});

test('Cognito HTTP callback creates persistent account/session and rejects state replay',{skip:!connectionString},async()=>{
 const f=await setup();const pair=await generateKeyPair('RS256');const jwk=await exportJWK(pair.publicKey);jwk.kid='fixture';const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Fixture';let nonce='';
 const cognito=new CognitoAuth({issuer,clientId:'fixture',domain:'https://fixture.auth.us-east-1.amazoncognito.com',publicUrl:f.base},new PgLoginStates(f.db),{keys:createLocalJWKSet({keys:[jwk]}),fetcher:async()=>new Response(JSON.stringify({id_token:await new SignJWT({nonce,email:'creator@example.com',email_verified:true,token_use:'id'}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject('creator').setIssuer(issuer).setAudience('fixture').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey)}))});
 const server=createTeamServer(f.store,{publicUrl:f.base,ownerToken:'x'.repeat(32),cognito,sessionStore:f.sessions});await new Promise<void>(r=>server.listen(f.port,'127.0.0.1',r));
 try{
  const login=await fetch(f.base+'/auth/login',{redirect:'manual'});assert.equal(login.status,302);const target=new URL(login.headers.get('location')!);nonce=target.searchParams.get('nonce')!;const state=target.searchParams.get('state')!;const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const callback=f.base+'/auth/callback?code=fixture&state='+encodeURIComponent(state);
  assert.equal((await fetch(callback,{redirect:'manual'})).status,400);
  const done=await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'});assert.equal(done.status,303);const sessionCookie=done.headers.getSetCookie().find(v=>v.startsWith('pensieve_session='))!.split(';')[0];
  const me=await fetch(f.base+'/api/team/me',{headers:{Cookie:sessionCookie}});assert.equal(me.status,200);assert.equal((await me.json()).user.name,'creator@example.com');
  assert.equal((await fetch(callback,{headers:{Cookie:cookie},redirect:'manual'})).status,400);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});


test('hosted browser loads later pages and preserves selections',{skip:!connectionString},async()=>{
 const f=await setup();const alice=await f.store.createUser('Synthetic executive');const pool=await f.store.createPool(alice.user.id,'Paged memory','private');
 await f.store.putMemories(alice.user.id,pool.id,Array.from({length:61},(_,i)=>makeMemory({text:'Synthetic page decision '+i,source:'manual',session:'fixture',role:'user',timestamp:'2026-11-07T00:00:00Z',locator:'fixture:'+i,project:'synthetic'})));
 const server=createTeamServer(f.store,{publicUrl:f.base,ownerToken:'x'.repeat(32),shareStore:f.shares,sessionStore:f.sessions,delivery:f.delivery});await new Promise<void>(r=>server.listen(f.port,'127.0.0.1',r));
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,executablePath:process.env.PENSIEVE_TEST_BROWSER??(existsSync(chrome)?chrome:undefined)});
 try{const page=await browser.newPage();await page.goto(f.base+'/#token='+alice.token);await expect(page.locator('#status')).toHaveText('Ready');await expect(page.locator('#memories article')).toHaveCount(50);await page.locator('#memories input').first().check();const selected=await page.locator('#memories input:checked').inputValue();await page.locator('#load-more').click();await expect(page.locator('#memories article')).toHaveCount(61);await expect(page.locator('#load-more')).toBeHidden();await expect(page.locator('#memories input:checked')).toHaveValue(selected);await page.locator('#agent-access summary').click();await page.locator('#create-token').click();await expect(page.locator('#created-token')).not.toHaveValue('');assert.equal((await fetch(f.base+'/api/team/me',{headers:{Authorization:'Bearer '+alice.token}})).status,401);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await f.close();}
});
