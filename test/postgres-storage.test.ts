import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {postgresPool,migratePostgres} from '../src/postgres.js';
import {PgTeamStore} from '../src/pg-team-store.js';
import {PgShareStore} from '../src/pg-share-store.js';
import {PgDeliveryLedger} from '../src/pg-delivery.js';
import {makeMemory} from '../src/sessions.js';
import type {Snapshot} from '../src/executive.js';
const databaseUrl=process.env.PENSIEVE_TEST_DATABASE_URL;

test('AC1/2/3/6/7 PostgreSQL repositories, isolation, vectors, snapshots and durable delivery',{skip:!databaseUrl},async t=>{
 const admin=postgresPool(databaseUrl!),name='pensieve_storage_'+randomBytes(6).toString('hex');await admin.query(`CREATE DATABASE ${name}`);const url=new URL(databaseUrl!);url.pathname='/'+name;const pool=postgresPool(url.href);
 try{
  await Promise.all([migratePostgres(pool),migratePostgres(pool)]);
  const store=await PgTeamStore.open(pool),shares=new PgShareStore(pool),delivery=new PgDeliveryLedger(pool);
  const alice=await store.createUser('Alice'),bob=await store.createUser('Bob');const shared=await store.createPool(alice.user.id,'Shared','shared');
  const memories=Array.from({length:5},(_,i)=>makeMemory({text:'Synthetic decision '+i,source:'manual',session:'fixture',role:'user',timestamp:'',locator:'fixture',project:'fixture'}));
  await t.test('AC2/3 atomic idempotent writes, ACL and keyset pagination',async()=>{
   assert.equal((await store.putMemories(alice.user.id,shared.id,memories)).imported,5);
   assert.equal((await store.putMemories(alice.user.id,shared.id,memories)).imported,0);
   await assert.rejects(store.putMemories(alice.user.id,shared.id,[{...memories[0],text:'conflicting'}]));
   await assert.rejects(store.getMemories(bob.user.id,shared.id,[memories[0].id]));
   await store.grantMember(alice.user.id,shared.id,bob.user.id,'reader');
   await assert.rejects(store.putMemory(bob.user.id,shared.id,memories[0]));
   const first=await store.listMemoryPage(alice.user.id,shared.id,{limit:2}),second=await store.listMemoryPage(alice.user.id,shared.id,{limit:2,cursor:first.nextCursor}),third=await store.listMemoryPage(alice.user.id,shared.id,{limit:2,cursor:second.nextCursor});
   assert.equal(new Set([...first.memories,...second.memories,...third.memories].map(r=>r.memory.id)).size,5);assert.equal(third.nextCursor,undefined);
   await assert.rejects(store.listMemoryPage(alice.user.id,shared.id,{limit:101}));
   const provider={identity:'fixture:two',embed:async(texts:string[])=>texts.map(text=>text.includes('0')?[1,0]:[0,1])};
   assert.equal(await store.index(alice.user.id,shared.id,provider),5);assert.equal(await store.index(alice.user.id,shared.id,provider),0);
   const hits=await store.search(alice.user.id,shared.id,'0',provider,1);assert.equal(hits[0].id,memories[0].id);assert.equal(hits[0].score,1);
   await assert.rejects(store.search(alice.user.id,shared.id,'x',{...provider,embed:async()=>[[1,0,0]]}));
  });
  await t.test('AC2/3 bounded import and indexing preserve atomic failure across batches',async()=>{
   const target=await store.createPool(alice.user.id,'Bulk','private');
   const batch=Array.from({length:530},(_,i)=>makeMemory({text:'Bulk decision '+i,source:'manual',session:'bulk',role:'user',timestamp:'',locator:'bulk',project:'bulk'}));
   const origins=batch.map(m=>({memoryId:m.id,contributorId:'imported-user',contributorName:'Imported',poolId:'source-pool',createdAt:'2026-01-01',sourceServer:'source-server',verification:'unverified-import' as const}));
   assert.equal((await store.putMemories(alice.user.id,target.id,batch,origins)).imported,530);
   assert.equal((await store.putMemories(alice.user.id,target.id,batch,origins)).imported,0);
   assert.equal(Number((await pool.query('SELECT count(*) n FROM team_origins WHERE pool=$1',[target.id])).rows[0].n),530);
   const fresh=batch.slice(0,300).map((m,i)=>makeMemory({...m,text:'New decision '+i}));
   await assert.rejects(store.putMemories(alice.user.id,target.id,[...fresh,{...batch[0],text:'conflict'}]));
   assert.equal(Number((await pool.query('SELECT count(*) n FROM team_memories WHERE pool=$1',[target.id])).rows[0].n),530);
   let calls=0;await assert.rejects(store.index(alice.user.id,target.id,{identity:'bulk-model',embed:async texts=>{assert.ok(texts.length<=16);if(++calls===3)throw Error('provider failed');return texts.map(()=>[1,0]);}}));
   assert.equal(Number((await pool.query('SELECT count(*) n FROM team_vectors WHERE pool=$1',[target.id])).rows[0].n),0);
   calls=0;assert.equal(await store.index(alice.user.id,target.id,{identity:'bulk-model',embed:async texts=>{calls++;assert.ok(texts.length<=16);return texts.map(()=>[1,0]);}}),530);assert.equal(calls,34);
  });
  await t.test('AC2/5 personal token rotation and revoked identity mapping',async()=>{
   const creator=await store.createUser('Token user');const {token}=await store.rotatePersonalToken(creator.user.id);
   await assert.rejects(store.authenticate(creator.token));assert.equal((await store.authenticate(token)).id,creator.user.id);
   const users=await Promise.all(Array.from({length:4},()=>store.accessUser('https://issuer.example','subject','alice@example.com')));assert.equal(new Set(users.map(u=>u.id)).size,1);
   await store.revokeUser(users[0].id);await assert.rejects(store.accessUser('https://issuer.example','subject','alice@example.com'));await assert.rejects(store.rotatePersonalToken(users[0].id));
  });
  let snapshot:Snapshot;
  await t.test('AC6 snapshot mapping is atomic and selected evidence cannot be substituted',async()=>{
   const bundle=await store.exportBundle(alice.user.id,shared.id,[memories[0].id]);
   snapshot=await store.createShare(alice.user.id,shared.id,{title:'Fixture',brief:'Reviewed fixture',recipients:['friend@example.com'],days:7,cloudAllowed:false,bundle:{...bundle,memories:[memories[1]]},ids:[memories[0].id],accessMode:'invitation-link'});
   assert.deepEqual(snapshot.bundle.memories.map(m=>m.id),[memories[0].id]);assert.equal((await store.listShares(alice.user.id,shared.id)).length,1);
   const before=Number((await pool.query('SELECT count(*) n FROM shares')).rows[0].n);
   await assert.rejects(store.createShare(alice.user.id,shared.id,{...snapshot,ids:['a'.repeat(64)]}));
   assert.equal(Number((await pool.query('SELECT count(*) n FROM shares')).rows[0].n),before);
   const token=await shares.invitation(snapshot.id,'friend@example.com');assert.equal((await shares.authorize(snapshot.id,token)).id,snapshot.id);
  });
  await t.test('AC3/6 scoped share summaries paginate and enforce owner/creator access',async()=>{
   const outsider=await store.createUser('Other owner'),otherPool=await store.createPool(outsider.user.id,'Other','private');await store.putMemory(outsider.user.id,otherPool.id,memories[0]);
   await store.createShare(outsider.user.id,otherPool.id,{...snapshot,title:'Must not leak',ids:[memories[0].id]});
   await store.grantMember(alice.user.id,shared.id,bob.user.id,'writer');
   const own=await store.createShare(bob.user.id,shared.id,{...snapshot,title:'Writer share',ids:[memories[0].id]});
   const first=await store.listSharePage(alice.user.id,shared.id,{limit:1});assert.equal(first.shares.length,1);assert.ok(first.nextCursor);
   const second=await store.listSharePage(alice.user.id,shared.id,{limit:1,cursor:first.nextCursor});assert.equal(second.shares.length,1);assert.equal(second.nextCursor,undefined);
   assert.deepEqual(new Set([...first.shares,...second.shares].map(s=>s.id)),new Set([snapshot.id,own.id]));assert.equal(first.shares[0].count,1);assert.ok(!('bundle' in first.shares[0]));
   assert.deepEqual((await store.listSharePage(bob.user.id,shared.id)).shares.map(s=>s.id),[own.id]);await assert.rejects(store.listSharePage(outsider.user.id,shared.id));await assert.rejects(store.listSharePage(alice.user.id,shared.id,{limit:101}));
  });
  await t.test('AC7 concurrent enqueue, worker restart and no ambiguous retry',async()=>{
   const message={email:'friend@example.com',title:'spoofed',url:'https://reader.example/s/'+snapshot.id,expiresAt:1,verified:false};
   await Promise.all([delivery.enqueue(alice.user.id,snapshot.id,[message]),delivery.enqueue(alice.user.id,snapshot.id,[message])]);
   let sent=0;const mailer={sendCode:async()=>{},sendInvitation:async(m:typeof message)=>{sent++;assert.equal(m.title,'Fixture');assert.ok(new URL(m.url).hash);throw Error('uncertain');}};
   await Promise.all([delivery.runBatch(mailer),new PgDeliveryLedger(pool).runBatch(mailer)]);assert.equal(sent,1);assert.equal((await delivery.status(snapshot.id))[0].status,'unknown');
   await delivery.send(alice.user.id,snapshot.id,[message],mailer);assert.equal(sent,1);
   const other=await store.createShare(alice.user.id,shared.id,{...snapshot,ids:[memories[0].id]});await delivery.enqueue(alice.user.id,other.id,[{...message,url:'https://reader.example/s/'+other.id}]);await shares.revoke(other.id);await delivery.runBatch(mailer);assert.equal(sent,1);assert.equal((await delivery.status(other.id))[0].status,'cancelled');
  });
  await t.test('AC6 recipient challenges enforce attempts and single consumption',async()=>{
   const bundle=await store.exportBundle(alice.user.id,shared.id,[memories[0].id]);const share=await store.createShare(alice.user.id,shared.id,{title:'Codes',brief:'Reviewed fixture',recipients:['code@example.com'],days:1,cloudAllowed:false,bundle,ids:[memories[0].id],accessMode:'email-code'});let code='';
   await shares.challenge(share.id,'code@example.com',{sendCode:async(_email,value)=>{code=value;}});assert.match(code,/^\d{8}$/);
   await assert.rejects(shares.verify(share.id,'code@example.com','wrong'));assert.equal((await pool.query('SELECT attempts FROM challenges WHERE share=$1',[share.id])).rows[0].attempts,1);
   const results=await Promise.allSettled([shares.verify(share.id,'code@example.com',code),shares.verify(share.id,'code@example.com',code)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  });
 }finally{await pool.end();await admin.query(`DROP DATABASE ${name}`);await admin.end();}
});
