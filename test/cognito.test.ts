import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {CognitoAuth,cognitoFromEnv,type LoginStates,type LoginState} from '../src/cognito.js';

class MemoryStates implements LoginStates {
  readonly states=new Map<string,LoginState>();
  async put(state:LoginState){this.states.set(state.digest,state);}
  async take(digest:string,browser:string,now:number){const state=this.states.get(digest);if(!state||state.browser!==browser||state.expires<=now)return;this.states.delete(digest);return state;}
}
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fixture';
const binding='b'.repeat(64);
const config={issuer,clientId:'fixtureclient',domain:'https://fixture.auth.us-east-1.amazoncognito.com',publicUrl:'https://pensieve.example.com'};
async function fixture(){
 const pair=await generateKeyPair('RS256'),wrong=await generateKeyPair('RS256');
 const jwk=await exportJWK(pair.publicKey);jwk.kid='fixture';
 const states=new MemoryStates();let current=Date.now();let override:Record<string,unknown>={};let wrongKey=false;let tokenCalls=0;
 const fetcher:typeof fetch=async(url,options)=>{
  tokenCalls++;assert.equal(String(url),config.domain+'/oauth2/token');assert.equal(options?.redirect,'error');
  const body=new URLSearchParams(String(options?.body));assert.equal(body.get('code_verifier'),login.verifier);assert.equal(body.get('redirect_uri'),'https://pensieve.example.com/auth/callback');assert.equal(body.get('client_id'),config.clientId);
  const token=await new SignJWT({sub:'alice',email:'alice@example.com',email_verified:true,token_use:'id',nonce:login.nonce,iss:issuer,aud:config.clientId,iat:Math.floor(current/1000),exp:Math.floor(current/1000)+300,...override}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(wrongKey?wrong.privateKey:pair.privateKey);
  return new Response(JSON.stringify({id_token:token}));
 };
 const auth=new CognitoAuth(config,states,{keys:createLocalJWKSet({keys:[jwk]}),fetcher,now:()=>current});
 let login:LoginState;
 const begin=async()=>{const url=new URL(await auth.begin(binding,'/?pool=fixture'));login=[...states.states.values()].at(-1)!;return url;};
 return {auth,states,begin,claims:(claims:Record<string,unknown>)=>{override=claims;},wrongKey:()=>{wrongKey=true;},advance:()=>{current+=301000;},calls:()=>tokenCalls};
}

test('AC4 Cognito binds state/browser and exchanges with S256 PKCE once',async()=>{
 const f=await fixture(),url=await f.begin();const state=url.searchParams.get('state')!;
 assert.equal(url.origin,config.domain);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 const saved=[...f.states.states.values()][0];assert.notEqual(saved.digest,state);assert.notEqual(saved.browser,binding);
 assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(saved.verifier).digest('base64url'));
 await assert.rejects(f.auth.complete({code:'fixture-code',state,browserBinding:'x'.repeat(64)}),/state/);assert.equal(f.calls(),0);
 const complete=await f.auth.complete({code:'fixture-code',state,browserBinding:binding});
 assert.deepEqual(complete,{identity:{issuer,subject:'alice',email:'alice@example.com'},returnTo:'/?pool=fixture'});
 await assert.rejects(f.auth.complete({code:'fixture-code',state,browserBinding:binding}),/state/);assert.equal(f.calls(),1);
});

test('AC4 Cognito rejects expired state, external destinations and invalid configuration',async()=>{
 const f=await fixture(),url=await f.begin();f.advance();await assert.rejects(f.auth.complete({code:'code',state:url.searchParams.get('state')!,browserBinding:binding}),/state/);
 for(const destination of ['https://evil.example','//evil.example','/\\evil.example','/#token=secret'])await assert.rejects(f.auth.begin(binding,destination),/destination/);
 await assert.rejects(f.auth.begin('weak','/'),/binding/);
 assert.throws(()=>new CognitoAuth({...config,issuer:'https://evil.example'},f.states));
 assert.throws(()=>new CognitoAuth({...config,domain:'https://user:pass@example.com'},f.states));
 assert.throws(()=>new CognitoAuth({...config,clientId:''},f.states));
});

test('AC4 Cognito rejects wrong token use, signature, issuer, audience, nonce, expiry and unverified email',async()=>{
 const negatives=[{token_use:'access'},{email_verified:false},{email_verified:'true'},{sub:''},{email:'bad'},{nonce:'wrong'},{iss:issuer+'different'},{aud:'other-client'},{aud:[config.clientId,'other-client']},{exp:1},{iat:Math.floor(Date.now()/1000)+10000}];
 for(const claims of negatives){const f=await fixture();f.claims(claims);const url=await f.begin();await assert.rejects(f.auth.complete({code:'code',state:url.searchParams.get('state')!,browserBinding:binding}));}
 const f=await fixture();f.wrongKey();const url=await f.begin();await assert.rejects(f.auth.complete({code:'code',state:url.searchParams.get('state')!,browserBinding:binding}));
});

test('AC4 failed exchanges burn state and never follow token endpoint redirects',async()=>{
 const states=new MemoryStates();let calls=0;
 const auth=new CognitoAuth(config,states,{fetcher:async(_url,options)=>{calls++;assert.equal(options?.redirect,'error');return new Response('unavailable',{status:503});}});
 const url=new URL(await auth.begin(binding));const args={code:'code',state:url.searchParams.get('state')!,browserBinding:binding};
 await assert.rejects(auth.complete(args),/provider/);await assert.rejects(auth.complete(args),/state/);assert.equal(calls,1);
});

test('AC4 environment configuration fails closed when incomplete',()=>{
 const prior=[process.env.PENSIEVE_COGNITO_ISSUER,process.env.PENSIEVE_COGNITO_CLIENT_ID,process.env.PENSIEVE_COGNITO_DOMAIN];
 try{
  delete process.env.PENSIEVE_COGNITO_ISSUER;delete process.env.PENSIEVE_COGNITO_CLIENT_ID;delete process.env.PENSIEVE_COGNITO_DOMAIN;
  assert.equal(cognitoFromEnv(config.publicUrl,new MemoryStates()),undefined);
  process.env.PENSIEVE_COGNITO_ISSUER=issuer;assert.throws(()=>cognitoFromEnv(config.publicUrl,new MemoryStates()));
 }finally{['PENSIEVE_COGNITO_ISSUER','PENSIEVE_COGNITO_CLIENT_ID','PENSIEVE_COGNITO_DOMAIN'].forEach((key,i)=>{if(prior[i]===undefined)delete process.env[key];else process.env[key]=prior[i];});}
});

// AC5 requires a real database; acceptance runs set this variable and assert no skips.
test('AC5 durable sessions, atomic state consumption and proof-based legacy linking', {skip:!process.env.PENSIEVE_TEST_DATABASE_URL},async()=>{
 const {Pool}=await import('pg');const {migratePostgres}=await import('../src/postgres.js');const {PgHostedSessions,PgLoginStates}=await import('../src/hosted-sessions.js');
 const admin=new Pool({connectionString:process.env.PENSIEVE_TEST_DATABASE_URL});const schema='auth_'+randomBytes(8).toString('hex');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:process.env.PENSIEVE_TEST_DATABASE_URL,options:'-c search_path='+schema+',public'});
 const hash=(v:string)=>createHash('sha256').update(v).digest('hex');let now=Date.now();
 try{
  await migratePostgres(pool);await pool.query('INSERT INTO team_users(id,name,token) VALUES($1,$2,$3),($4,$5,$6)',['alice','Alice',hash('personal-alice'),'legacy','Legacy',hash('personal-legacy')]);
  const identity={issuer,subject:'alice',email:'alice@example.com'};await pool.query('INSERT INTO team_access_identities VALUES($1,$2,$3)',[issuer,'alice','alice']);
  const sessions=new PgHostedSessions(pool,()=>now);const token=await sessions.create('alice',identity);assert.match(token,/^[a-f0-9]{64}$/);
  assert.equal((await new PgHostedSessions(pool,()=>now).get(token))?.userId,'alice');
  await assert.rejects(sessions.create('legacy',identity),/belong/);
  await Promise.all(Array.from({length:8},()=>sessions.create('alice',identity)));assert.equal(Number((await pool.query('SELECT count(*) n FROM hosted_sessions WHERE actor=$1',['alice'])).rows[0].n),5);
  const last=await sessions.create('alice',identity);await sessions.destroy(last);assert.equal(await sessions.get(last),undefined);
  const prelink=await sessions.create('alice',identity);await assert.rejects(sessions.linkIdentity(identity,'wrong'),/credential/);
  assert.equal((await sessions.linkIdentity(identity,'personal-legacy')).id,'legacy');assert.equal(await sessions.get(prelink),undefined);
  const linked=await sessions.create('legacy',identity);assert.equal((await sessions.get(linked))?.userId,'legacy');
  await pool.query("INSERT INTO team_pools VALUES('used-pool','Used','private')");await pool.query("INSERT INTO team_members VALUES('used-pool','legacy','owner')");
  await assert.rejects(sessions.linkIdentity(identity,'personal-alice'),/existing data/);
  assert.equal((await sessions.get(linked))?.userId,'legacy');
  await pool.query('UPDATE team_users SET active=0 WHERE id=$1',['legacy']);assert.equal(await sessions.get(linked),undefined);await assert.rejects(sessions.linkIdentity(identity,'personal-legacy'));
  const states=new PgLoginStates(pool,()=>now);const record={digest:hash('state'),browser:hash('browser'),nonce:'nonce',verifier:'verifier',returnTo:'/',expires:now+1000};await states.put(record);
  const consumed=await Promise.all([states.take(record.digest,record.browser,now),states.take(record.digest,record.browser,now)]);assert.equal(consumed.filter(Boolean).length,1);
  const ephemeral=await sessions.create('alice');now+=43_200_001;assert.equal(await sessions.get(ephemeral),undefined);
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
