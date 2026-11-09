import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {createServer} from 'node:net';
import {accessVerifier} from '../src/access.js';
import {DeliveryLedger,type SecureMailer} from '../src/delivery.js';
import {verificationGuard} from '../src/verification-guard.js';
import {TeamStore} from '../src/team-store.js';
import {ShareStore} from '../src/executive.js';
import {createTeamServer} from '../src/team-server.js';
import {makeMemory} from '../src/sessions.js';

test('Access validates signature, issuer, audience, expiry and subject',async()=>{
 const pair=await generateKeyPair('RS256'),other=await generateKeyPair('RS256');
 const jwk=await exportJWK(pair.publicKey);jwk.kid='fixture';
 const verify=accessVerifier('https://synthetic.cloudflareaccess.com','aud',createLocalJWKSet({keys:[jwk]}));
 const sign=(claims:Record<string,unknown>={},wrongKey=false)=>new SignJWT({type:'app',sub:'user',iss:'https://synthetic.cloudflareaccess.com',aud:'aud',exp:Math.floor(Date.now()/1000)+60,...claims}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(wrongKey?other.privateKey:pair.privateKey);
 await verify(await sign()); await verify(await sign({sub:'',common_name:'synthetic-service.access'}));
 for(const claims of [{type:'org'},{aud:'other'},{iss:'https://attacker.example'},{exp:1},{sub:''}])await assert.rejects(verify(await sign(claims)));
 await assert.rejects(verify(await sign({},true)));await assert.rejects(verify('forged'));
 assert.throws(()=>accessVerifier('https://cloudflareaccess.com.attacker.example','aud'));
});

test('delivery reservations suppress concurrent/restarted duplicates and unknown outcomes',async()=>{
 const db=new DatabaseSync(':memory:');const ledger=new DeliveryLedger(db);
 let sent=0;let unblock!:()=>void;const block=new Promise<void>(r=>{unblock=r;});
 const mailer:SecureMailer={sendCode:async()=>{},sendInvitation:async()=>{sent++;await block;}};
 const message={email:'friend@example.com',title:'Fixture',url:'https://example.com/s/fixture',expiresAt:Date.now()+1000,verified:true};
 try{
 const first=ledger.send('actor','share',[message],mailer);
 await ledger.send('actor','share',[message],mailer);assert.equal(sent,1);unblock();await first;
 await new DeliveryLedger(db).send('actor','share',[message],mailer);assert.equal(sent,1);
 assert.equal(ledger.statuses(['share',...Array.from({length:501},(_,i)=>'absent'+i)]).get('share')?.[0].status,'sent'); assert.equal(ledger.statuses([]).size,0);
 const failed=await ledger.send('actor','other',[message],{...mailer,sendInvitation:async()=>{throw Error('timeout after possible acceptance');}});
 assert.equal(failed[0].status,'unknown');
 await ledger.send('actor','other',[message],mailer);assert.equal(sent,1);
 }finally{db.close();}
});

test('delivery quota admission is atomic and persists across ledger recreation',async()=>{
 const db=new DatabaseSync(':memory:');const mailer:SecureMailer={sendCode:async()=>{},sendInvitation:async()=>{}};const ledger=new DeliveryLedger(db);
 const msg=(email:string)=>({email,title:'Fixture',url:'https://example.com',expiresAt:1,verified:true});
 try{
 for(let i=0;i<5;i++)await ledger.send('actor','s'+i,[msg('limited@example.com')],mailer);
 await assert.rejects(new DeliveryLedger(db).send('actor','blocked',[msg('fresh@example.com'),msg('limited@example.com')],mailer),/quota/);
 assert.equal(ledger.status('blocked').length,0);
 assert.equal(db.prepare("SELECT count(*) n FROM delivery_quota WHERE scope='email:fresh@example.com'").get()!.n,0);
 }finally{db.close();}
});

test('verification guard limits persist and Turnstile verifies exact hostname/action',async()=>{
 const db=new DatabaseSync(':memory:');let response={success:true,hostname:'reader.example',action:'pensieve-email'};
 const config={siteKey:'site',secret:'secret',hostname:'reader.example',fetcher:async()=>new Response(JSON.stringify(response))};
 const guard=verificationGuard(db,config);
 try{
 await assert.rejects(guard.verifyHuman(''),/challenge/);await guard.verifyHuman('fixture');
 response={...response,hostname:'attacker.example'};await assert.rejects(guard.verifyHuman('fixture'),/failed/);
 response={...response,hostname:'reader.example',action:'other'};await assert.rejects(guard.verifyHuman('fixture'),/failed/);
 for(let i=0;i<10;i++)guard.check('code','address');
 assert.throws(()=>verificationGuard(db,config).check('code','address'),/Too many/);
 assert.throws(()=>verificationGuard(db,{siteKey:'missing-secret'}),/Complete/);
 }finally{db.close();}
});

async function fixture(options:{failCode?:boolean;turnstile?:boolean}={}){
 const net=createServer();await new Promise<void>(r=>net.listen(0,'127.0.0.1',r));const addr=net.address();assert.ok(addr&&typeof addr!=='string');await new Promise<void>(r=>net.close(()=>r()));
 const base='http://127.0.0.1:'+addr.port;
 const store=new TeamStore(':memory:'),shares=new ShareStore(':memory:');
 const alice=store.createUser('Alice'),bob=store.createUser('Bob');const pool=store.createPool(alice.user.id,'Fixture','shared');
 const memory=makeMemory({text:'Synthetic decision',source:'manual',session:'fixture',role:'user',timestamp:'',locator:'fixture',project:'/fixture'});
 store.putMemory(alice.user.id,pool.id,memory);
 const invitations:unknown[]=[],codes:{email:string;code:string}[]=[];
 const server=createTeamServer(store,{ownerToken:'synthetic-owner-token-'.repeat(3),publicUrl:base,shareStore:shares,access:async token=>{if(token!=='verified-access')throw Error('no');},verification:verificationGuard(shares.db,options.turnstile?{siteKey:'fixture',secret:'fixture',hostname:'127.0.0.1',fetcher:async(_url,init)=>new Response(JSON.stringify({success:new URLSearchParams(String(init?.body)).get('response')==='valid',hostname:'127.0.0.1',action:'pensieve-email'}))}:{}),mailer:{sendInvitation:async m=>{invitations.push(m);},sendCode:async(email,code)=>{if(options.failCode)throw Error('synthetic provider rejection');codes.push({email,code});}}});
 await new Promise<void>(r=>server.listen(addr.port,'127.0.0.1',r));
 const request=(path:string,body?:unknown,token=alice.token,access=true)=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(access?{'Cf-Access-Jwt-Assertion':'verified-access'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {base,store,shares,alice,bob,pool,memory,invitations,codes,request,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();shares.close();}};
}

test('origin gate, verified sharing, send authorization, replay and revocation',async()=>{
 const f=await fixture();try{
 assert.equal((await f.request('/api/team/pools',undefined,f.alice.token,false)).status,401);
 assert.equal((await f.request('/api/team/pools',undefined,'',true)).status,401);
 assert.equal((await f.request('/health',undefined,'',false)).status,200);
 const path='/api/team/pools/'+f.pool.id+'/shares';
 const res=await f.request(path,{ids:[f.memory.id],title:'Fixture',brief:'Reviewed fixture',recipients:['friend@example.com'],days:7,accessMode:'email-code'});
 assert.equal(res.status,201);const share=await res.json();assert.equal(new URL(share.invitations[0].url).hash,'');
 assert.equal((await f.request('/s/'+share.id,undefined,'',false)).status,200);
 assert.equal((await f.request('/api/reader/'+share.id,undefined,'',false)).status,401);
 assert.equal((await f.request(path+'/'+share.id+'/send',{},f.bob.token)).status,404);
 const sent=await f.request(path+'/'+share.id+'/send',{recipients:['evil@example.com'],url:'https://evil.example'});
 assert.equal(sent.status,200);assert.equal((f.invitations[0] as {email:string}).email,'friend@example.com');
 await f.request(path+'/'+share.id+'/send',{});assert.equal(f.invitations.length,1);
 await f.request('/api/reader/'+share.id+'/code',{email:'outsider@example.com'},'',false);assert.equal(f.codes.length,0);
 await f.request('/api/reader/'+share.id+'/code',{email:'friend@example.com'},'',false);assert.equal(f.codes.length,1);
 const verification=await f.request('/api/reader/'+share.id+'/verify',f.codes[0],'',false);
 assert.equal(verification.status,200);const {token}=await verification.json();
 assert.equal((await f.request('/api/reader/'+share.id,undefined,token,false)).status,200);
 assert.equal((await f.request('/api/reader/'+share.id+'/verify',f.codes[0],'',false)).status,400);
 await f.request(path+'/'+share.id+'/revoke',{});
 assert.equal((await f.request('/api/reader/'+share.id,undefined,token,false)).status,401);
 }finally{await f.close();}
});


test('invalid challenges cannot exhaust another recipient behind the same proxy',async()=>{
 const f=await fixture({turnstile:true});try{
 const res=await f.request('/api/team/pools/'+f.pool.id+'/shares',{ids:[f.memory.id],title:'Fixture',brief:'Reviewed',recipients:['friend@example.com'],days:7,accessMode:'email-code'});
 const share=await res.json();
 for(let i=0;i<12;i++)assert.equal((await f.request('/api/reader/'+share.id+'/code',{email:'friend@example.com',turnstileToken:'invalid'},'',false)).status,400);
 assert.equal((await f.request('/api/reader/'+share.id+'/code',{email:'friend@example.com',turnstileToken:'valid'},'',false)).status,200);
 assert.equal(f.codes.length,1);
 const guard=verificationGuard(f.shares.db);for(let i=0;i<10;i++)guard.check('code','proxy','A:one@example.com');
 assert.doesNotThrow(()=>guard.check('code','proxy','B:two@example.com'));
 }finally{await f.close();}
});

test('provider and quota failures do not disclose invitation membership',async()=>{
 for(const failCode of [true,false]){
 const f=await fixture({failCode});try{
 const res=await f.request('/api/team/pools/'+f.pool.id+'/shares',{ids:[f.memory.id],title:'Fixture',brief:'Reviewed',recipients:['friend@example.com'],days:7,accessMode:'email-code'});const share=await res.json();
 if(!failCode){const ledger=new DeliveryLedger(f.shares.db);for(let i=0;i<5;i++)ledger.reserveCode('friend@example.com');}
 const invited=await f.request('/api/reader/'+share.id+'/code',{email:'friend@example.com'},'',false);
 const outsider=await f.request('/api/reader/'+share.id+'/code',{email:'outsider@example.com'},'',false);
 assert.equal(invited.status,200);assert.equal(outsider.status,200);assert.deepEqual(await invited.json(),await outsider.json());
 }finally{await f.close();}
 }
});

test('verified signup isolates identities, persists mappings and respects revocation',async()=>{
 const store=new TeamStore(':memory:');
 try {
  const alice=store.accessUser('https://fixture.cloudflareaccess.com','alice','alice@example.com');
  const again=store.accessUser('https://fixture.cloudflareaccess.com','alice','changed@example.com');
  assert.equal(again.id,alice.id);
  const other=store.accessUser('https://fixture.cloudflareaccess.com','other','alice@example.com');
  assert.notEqual(other.id,alice.id);
  const pool=store.createPool(alice.id,'Private','private');
  assert.deepEqual(store.listPools(other.id),[]);
  assert.throws(()=>store.getPool(other.id,pool.id));
  store.revokeUser(alice.id);
  assert.throws(()=>store.accessUser('https://fixture.cloudflareaccess.com','alice','alice@example.com'));
  assert.throws(()=>store.accessUser('issuer','','a@example.com'));
  assert.throws(()=>createTeamServer(store,{publicUrl:'http://localhost',ownerToken:'x'.repeat(32),openSignup:true}));
 } finally {store.close();}
});

test('signup requires verified human JWT, same origin and creates a usable session',async()=>{
 const store=new TeamStore(':memory:');
 let identity:{issuer:string;subject:string;email?:string}={issuer:'https://fixture.cloudflareaccess.com',subject:'alice',email:'alice@example.com'};
 const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const addr=probe.address();assert.ok(addr&&typeof addr!=='string');await new Promise<void>(r=>probe.close(()=>r()));
 const base='http://127.0.0.1:'+addr.port;
 const server=createTeamServer(store,{publicUrl:base,ownerToken:'x'.repeat(32),openSignup:true,access:async token=>{if(token!=='verified')throw Error('invalid');return identity;}});
 await new Promise<void>(r=>server.listen(addr.port,'127.0.0.1',r));
 const sign=(origin=base,token='verified')=>fetch(base+'/api/team/access-session',{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':token,'Content-Type':'application/json'},body:'{}'});
 try {
  assert.equal((await sign('https://evil.example')).status,403);
  assert.equal((await sign(base,'forged')).status,401);
  const response=await sign();assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie')!.split(';')[0];
  const me=await fetch(base+'/api/team/me',{headers:{Cookie:cookie,'Cf-Access-Jwt-Assertion':'verified'}});assert.equal(me.status,200);
  identity={issuer:identity.issuer,subject:'bob',email:'bob@example.com'};
  assert.equal((await fetch(base+'/api/team/me',{headers:{Cookie:cookie,'Cf-Access-Jwt-Assertion':'verified'}})).status,401);
  identity={issuer:identity.issuer,subject:'alice',email:'alice@example.com'};
  for(let i=0;i<6;i++)assert.equal((await sign()).status,200);
  assert.equal((await fetch(base+'/api/team/me',{headers:{Cookie:cookie,'Cf-Access-Jwt-Assertion':'verified'}})).status,401);
  identity={issuer:identity.issuer,subject:''};assert.equal((await sign()).status,401);
  identity={issuer:identity.issuer,subject:'human-no-email'};assert.equal((await sign()).status,401);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
