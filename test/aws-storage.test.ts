import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {AwsDatabase,type AwsItem,type AwsKey,type AwsWrite,type AwsPage} from '../src/aws-db.js';
import {AwsTeamStore,type AwsVectorIndex} from '../src/aws-team-store.js';
import {makeMemory} from '../src/sessions.js';
import type {Memory} from '../src/types.js';
const table=process.env.PENSIEVE_AWS_TEST_TABLE;
const client=new DynamoDBClient({maxAttempts:12,retryMode:'adaptive',region:process.env.AWS_REGION??'us-east-1',...(process.env.PENSIEVE_AWS_TEST_ENDPOINT?{endpoint:process.env.PENSIEVE_AWS_TEST_ENDPOINT,credentials:{accessKeyId:'local',secretAccessKey:'local'}}:{})});
const manifest='/tmp/pensieve-aws-storage-owned-'+randomUUID()+'.json';
const owned=new Map<string,{pk:string;sk:string}>();
const documentClient=DynamoDBDocumentClient.from(client,{marshallOptions:{removeUndefinedValues:true}});
documentClient.middlewareStack.add(next=>async args=>{const input=args.input as {Item?:{pk?:string;sk?:string};TransactItems?:{Put?:{Item?:{pk?:string;sk?:string}}}[]};for(const item of [input.Item,...(input.TransactItems??[]).map(x=>x.Put?.Item)])if(item?.pk&&item.sk&&item.pk!=='SYSTEM')owned.set(JSON.stringify([item.pk,item.sk]),{pk:item.pk,sk:item.sk});writeFileSync(manifest,JSON.stringify([...owned.values()]),{mode:0o600});return next(args);},{step:'initialize',name:'recordOwnedCanaryKeys'});
const db=new AwsDatabase(documentClient,table??'not-configured');
const memory=(text:string):Memory=>makeMemory({text,source:'manual',session:'aws-test-'+randomUUID(),role:'user',timestamp:new Date().toISOString(),locator:'test',project:'aws-canary'});
const provider={identity:'test:v1',embed:async(texts:string[])=>texts.map(()=>[1,0])};
const vectors:AwsVectorIndex={upsert:async()=>{},query:async()=>[]};
test('AC1/2/3 DynamoDB repositories publish bounded imports atomically and preserve provenance',{skip:!table},async()=>{
 const store=await AwsTeamStore.open(db,{vectors}),alice=await store.createUser('Alice '+randomUUID()),bob=await store.createUser('Bob '+randomUUID());
 const pool=await store.createPool(alice.user.id,'Storage canary','shared');assert.equal((await store.authenticate(alice.token)).id,alice.user.id);
 await store.grantMember(alice.user.id,pool.id,bob.user.id,'reader');await assert.rejects(store.putMemory(bob.user.id,pool.id,memory('denied')),/Writer/);
 const records=Array.from({length:53},(_,i)=>memory('decision '+i)),result=await store.putMemories(alice.user.id,pool.id,records);assert.equal(result.imported,53);
 const first=await store.listMemoryPage(alice.user.id,pool.id);assert.equal(first.memories.length,50);assert.ok(first.nextCursor);const second=await store.listMemoryPage(alice.user.id,pool.id,{cursor:first.nextCursor});assert.equal(second.memories.length,3);assert.equal(new Set([...first.memories,...second.memories].map(r=>r.memory.id)).size,53);
 assert.equal((await store.putMemories(alice.user.id,pool.id,records)).imported,0);
 const added=Array.from({length:20},(_,i)=>memory('staged '+i));await assert.rejects(store.putMemories(alice.user.id,pool.id,[...added,{...records[0],text:'conflict'}]),/Conflicting/);
 await assert.rejects(store.getMemories(alice.user.id,pool.id,[added[0].id]),/unavailable/);assert.equal((await store.listMemories(alice.user.id,pool.id)).length,53);
 const failed=await db.get(`POOL#${pool.id}`,`MEMORY#${added[0].id}`);assert.equal(await store.cleanupAbandonedBatch(String(failed?.batchId)),16);assert.equal(await store.cleanupAbandonedBatch(String(failed?.batchId)),0);assert.equal(await db.get(`POOL#${pool.id}`,`MEMORY#${added[0].id}`),undefined);const committed=await db.get(`POOL#${pool.id}`,`MEMORY#${records[0].id}`);assert.equal(await store.cleanupAbandonedBatch(String(committed?.batchId)),0);
 assert.equal((await store.putMemories(alice.user.id,pool.id,added)).imported,20);
 const origin={memoryId:records[0].id,contributorId:'source-author',contributorName:'Source',poolId:'source-pool',createdAt:new Date().toISOString(),sourceServer:'source-server',verification:'source-server' as const};
 await store.putMemories(alice.user.id,pool.id,[records[0]],[origin]);await store.putMemories(alice.user.id,pool.id,[records[0]],[origin]);
 const bundle=await store.exportBundle(alice.user.id,pool.id,[records[0].id]);assert.equal(bundle.provenance?.filter(p=>p.sourceServer==='source-server').length,1);assert.equal(bundle.provenance?.find(p=>p.sourceServer==='source-server')?.verification,'unverified-import');
 await assert.rejects(store.listMemoryPage(alice.user.id,pool.id,{limit:101}),/Page limit/);
 const staleId=randomUUID(),staleMemory=memory('abandoned lease'),staleRow={...committed!,pk:`POOL#${pool.id}`,sk:`MEMORY#${staleMemory.id}`,memory:staleMemory,batchId:staleId};
 await db.put(staleRow);await db.put({pk:`BATCH#${staleId}`,sk:'META',kind:'index-batch',state:'staging',poolId:pool.id,actor:alice.user.id,created:Date.now()-16*60000});
 for(const id of [staleMemory.id,records[0].id])await db.put({pk:`BATCH#${staleId}`,sk:`JOB#${id}`,memoryId:id,poolId:pool.id,revision:'fixture',state:'pending'});
 await db.put({pk:'WORK#INDEX',sk:`PENDING#${staleId}`,batchId:staleId});assert.equal(await store.cleanupAbandonedBatch(staleId),2);assert.equal(await db.get(staleRow.pk,staleRow.sk),undefined);assert.ok(await db.get(`POOL#${pool.id}`,`MEMORY#${records[0].id}`),'AC3 cleanup never deletes a different committed batch');
 const token=await store.rotatePersonalToken(alice.user.id);await assert.rejects(store.authenticate(alice.token),/Unauthorized/);assert.equal((await store.authenticate(token.token)).id,alice.user.id);
});
test('AC3/4/5 DynamoDB indexing retries bounded work and rejects stale or cross-pool candidates',{skip:!table},async()=>{
 const upserts:{memoryId:string;revision:string;poolId:string}[][]=[];let hits:{memoryId:string;revision:string;score:number}[]=[];
 const index:AwsVectorIndex={upsert:async records=>{upserts.push(records);},query:async()=>hits};const store=await AwsTeamStore.open(db,{vectors:index});
 const user=await store.createUser('Indexer '+randomUUID()),pool=await store.createPool(user.user.id,'Index canary','private'),records=Array.from({length:33},(_,i)=>memory('index '+i));await store.putMemories(user.user.id,pool.id,records);
 const row=await db.get(`POOL#${pool.id}`,`MEMORY#${records[0].id}`),batchId=String(row?.batchId);assert.ok(batchId);
 await assert.rejects(store.processIndexBatch(batchId,{identity:'test:v1',embed:async()=>{throw Error('provider unavailable');}}),/provider unavailable/);assert.equal(upserts.length,0);
 const first=await store.processIndexBatch(batchId,provider);assert.equal(first.processed,16);assert.equal(first.done,false);await store.processIndexBatch(batchId,provider);assert.equal((await store.processIndexBatch(batchId,provider)).done,true);assert.equal(upserts.flat().length,33);assert.equal((await store.processIndexBatch(batchId,provider)).processed,0);
 hits=[{memoryId:records[0].id,revision:'stale',score:1},{memoryId:memory('foreign').id,revision:'foreign',score:1}];assert.deepEqual(await store.search(user.user.id,pool.id,'query',provider),[]);
 await store.index(user.user.id,pool.id,provider);const runKey='INDEX-RUN#'+createHash('sha256').update(provider.identity).digest('hex');const run=await db.get(`POOL#${pool.id}`,runKey);await store.index(user.user.id,pool.id,provider);assert.equal((await db.get(`POOL#${pool.id}`,runKey))?.batchId,run?.batchId);let done=false;while(!done)done=(await store.processIndexBatch(String(run?.batchId),provider)).done;assert.equal(upserts.flat().length,33,'AC5 ready revisions are not embedded again');await assert.rejects(store.index(user.user.id,pool.id,provider),/cooldown/);
 const correct=upserts.flat().find(r=>r.memoryId===records[0].id)!;hits=[{memoryId:correct.memoryId,revision:correct.revision,score:0.8}];assert.equal((await store.search(user.user.id,pool.id,'query',provider))[0].id,correct.memoryId);
 await assert.rejects(store.search(user.user.id,pool.id,'query',{identity:'test:v1',embed:async()=>{await store.revokeUser(user.user.id);return [[1,0]];}}),/Unauthorized/);
});
test('AC3/8 DynamoDB selected share publication includes current authorization and no extra memories',{skip:!table},async()=>{
 const store=await AwsTeamStore.open(db,{prepareSnapshot:async input=>{const id=randomUUID().replaceAll('-',''),now=Date.now(),snapshot={...input,id,createdAt:now,expiresAt:now+86400000,revoked:false};return {snapshot,actions:[db.putAction({pk:`SHARE#${id}`,sk:'META',id,title:input.title,recipients:input.recipients,expiresAt:snapshot.expiresAt,revoked:false,count:input.bundle.memories.length},'attribute_not_exists(pk)')]};}});
 const u=await store.createUser('Sharer '+randomUUID()),pool=await store.createPool(u.user.id,'Share canary','private'),memories=[memory('selected'),memory('excluded')];await store.putMemories(u.user.id,pool.id,memories);const bundle=await store.exportBundle(u.user.id,pool.id,[memories[0].id]);
 const snapshot=await store.createShare(u.user.id,pool.id,{title:'Selected',brief:'Reviewed',recipients:['friend@example.com'],days:1,cloudAllowed:false,bundle,ids:[memories[0].id]});assert.deepEqual(snapshot.bundle.memories.map(m=>m.id),[memories[0].id]);
 const page=await store.listSharePage(u.user.id,pool.id);assert.equal(page.shares.length,1);assert.equal(page.shares[0].count,1);assert.equal((await db.get(`SHARE#${snapshot.id}`,'META'))?.creatorId,u.user.id);
});

/** Unit command fixture: validates conditional transitions without touching an AWS table. */
class IndexActorFixture extends AwsDatabase {
 readonly rows=new Map<string,AwsItem>();readonly transactions:AwsWrite[][]=[];
 beforeTransaction?:()=>void;beforeGet?:(pk:string,sk:string)=>void;
 constructor(){super(documentClient,'unit-only');}
 key(pk:string,sk:string){return JSON.stringify([pk,sk]);}
 seed(item:AwsItem){this.rows.set(this.key(item.pk,item.sk),structuredClone(item));}
 override async get<T extends AwsItem=AwsItem>(pk:string,sk:string):Promise<T|undefined>{this.beforeGet?.(pk,sk);return structuredClone(this.rows.get(this.key(pk,sk))) as T|undefined;}
 override async batchGet<T extends AwsItem=AwsItem>(keys:AwsKey[]):Promise<T[]>{const rows=await Promise.all(keys.map(k=>this.get<T>(k.pk,k.sk)));return rows.filter((r):r is T=>!!r);}
 override async query<T extends AwsItem=AwsItem>(pk:string,options:{prefix?:string;after?:string;limit?:number}={}):Promise<AwsPage<T>>{return {items:[...this.rows.values()].filter(r=>r.pk===pk&&(!options.prefix||r.sk.startsWith(options.prefix))).slice(0,options.limit??50) as T[]};}
 override async delete(pk:string,sk:string){this.rows.delete(this.key(pk,sk));}
 override async transact(actions:AwsWrite[]){
  this.beforeTransaction?.();this.transactions.push(structuredClone(actions));
  const reject=()=>{const error=new Error('Condition changed');error.name='TransactionCanceledException';throw error;};
  for(const action of actions){const operation=action.ConditionCheck??action.Put;const key=action.ConditionCheck?.Key??action.Put?.Item;if(!operation||!key)continue;const row=this.rows.get(this.key(String(key.pk),String(key.sk))),condition=operation.ConditionExpression??'',values=operation.ExpressionAttributeValues??{};
   if(condition.includes('attribute_not_exists(pk)')&&row)reject();
   if(condition.includes('active=:inactive')&&(row?.active!==false||row.version!==values[':v']))reject();
   if(condition.includes('active=:active')&&(row?.active!==true||row.version!==values[':v']))reject();
   if(condition==='version=:v'&&row?.version!==values[':v'])reject();
   if(condition.includes('#state=:committed')&&(row?.state!=='committed'||row.indexState!=='pending'||row.indexVersion!==values[':v']))reject();
   if(condition==='indexVersion=:v'&&row?.indexVersion!==values[':v'])reject();
  }
  for(const action of actions){if(action.Put)this.seed(action.Put.Item as AwsItem);if(action.Delete)this.rows.delete(this.key(String(action.Delete.Key.pk),String(action.Delete.Key.sk)));}
 }
}
async function actorIndexFixture(active:boolean){
 const fixture=new IndexActorFixture(),record=memory('Preserve inactive-owner memory'),revision='unit-revision';
 fixture.seed({pk:'SYSTEM',sk:'ISSUER',value:'unit-issuer'});
 fixture.seed({pk:'USER#owner',sk:'META',id:'owner',name:'Owner',active,version:1,token:'hash'});
 fixture.seed({pk:'USER#writer',sk:'META',id:'writer',name:'Writer',active:true,version:1,token:'hash-writer'});
 fixture.seed({pk:'POOL#pool',sk:'META',id:'pool',name:'Pool',visibility:'shared',owner:'owner',version:1});
 for(const [actor,role] of [['owner','owner'],['writer','writer']])fixture.seed({pk:'POOL#pool',sk:`MEMBER#${actor}`,actor,role,version:1});
 fixture.seed({pk:'BATCH#batch',sk:'META',kind:'index-batch',state:'committed',actor:'owner',poolId:'pool',created:1,indexState:'pending',indexVersion:0});
 fixture.seed({pk:'BATCH#batch',sk:`JOB#${record.id}`,memoryId:record.id,poolId:'pool',revision,state:'pending'});
 fixture.seed({pk:'WORK#INDEX',sk:'PENDING#batch',batchId:'batch'});
 fixture.seed({pk:'POOL#pool',sk:`MEMORY#${record.id}`,memory:record,revision,contributorId:'owner',contributorName:'Owner',createdAt:new Date().toISOString(),batchId:'batch',origins:[],version:1});
 let embeds=0,upserts=0;
 const store=await AwsTeamStore.open(fixture,{vectors:{upsert:async()=>{upserts++;},query:async()=>[]}});
 const embedding={identity:'unit:model',embed:async(texts:string[])=>{embeds++;return texts.map(()=>[1,0]);}};
 return {fixture,store,record,embedding,counts:()=>({embeds,upserts})};
}
test('AC4/5 inactive actor blocks its batch atomically without embedding or deleting memory/jobs',async()=>{
 const f=await actorIndexFixture(false),memoryKey=`MEMORY#${f.record.id}`,beforeMemory=await f.fixture.get('POOL#pool',memoryKey),beforeJob=await f.fixture.get('BATCH#batch',`JOB#${f.record.id}`);
 assert.deepEqual(await f.store.processIndexBatch('batch',f.embedding),{processed:0,done:true});assert.deepEqual(f.counts(),{embeds:0,upserts:0});
 const batch=await f.fixture.get('BATCH#batch','META');assert.equal(batch?.indexState,'blocked');assert.equal(batch?.reason,'inactive-actor');assert.equal(batch?.indexVersion,1);assert.equal(await f.fixture.get('WORK#INDEX','PENDING#batch'),undefined);
 assert.deepEqual(await f.fixture.get('POOL#pool',memoryKey),beforeMemory);assert.deepEqual(await f.fixture.get('BATCH#batch',`JOB#${f.record.id}`),beforeJob);
 const tx=f.fixture.transactions[0];assert.equal(tx.length,3);assert.equal(tx[0].ConditionCheck?.ExpressionAttributeValues?.[':inactive'],false);assert.match(tx[0].ConditionCheck?.ConditionExpression??'',/version=:v/);assert.match(tx[1].Put?.ConditionExpression??'',/indexVersion=:v/);
 await f.store.index('writer','pool',f.embedding);const runKey='INDEX-RUN#'+createHash('sha256').update(f.embedding.identity).digest('hex');const run=await f.fixture.get('POOL#pool',runKey);assert.ok(run?.batchId);assert.notEqual(run.batchId,'batch');assert.equal((await f.fixture.get(`BATCH#${run.batchId}`,'META'))?.actor,'writer');assert.equal((await f.store.processIndexBatch(String(run.batchId),f.embedding)).processed,1);assert.deepEqual(f.counts(),{embeds:1,upserts:1});assert.equal((await f.fixture.get('BATCH#batch','META'))?.indexState,'blocked');
});
test('AC4/5 deactivation between actor reads blocks before embedding',async()=>{
 const f=await actorIndexFixture(true);let reads=0;f.fixture.beforeGet=pk=>{if(pk==='USER#owner'&&++reads===2){const row=f.fixture.rows.get(f.fixture.key(pk,'META'))!;f.fixture.seed({...row,active:false,version:2});}};
 assert.deepEqual(await f.store.processIndexBatch('batch',f.embedding),{processed:0,done:true});assert.deepEqual(f.counts(),{embeds:0,upserts:0});assert.equal((await f.fixture.get('BATCH#batch','META'))?.reason,'inactive-actor');
});
test('AC4/5 deactivation during embedding blocks before vector publication',async()=>{
 const f=await actorIndexFixture(true);const embedding={...f.embedding,embed:async(texts:string[])=>{const result=await f.embedding.embed(texts);const row=await f.fixture.get('USER#owner','META');f.fixture.seed({...row!,active:false,version:2});return result;}};
 assert.deepEqual(await f.store.processIndexBatch('batch',embedding),{processed:0,done:true});assert.deepEqual(f.counts(),{embeds:1,upserts:0});assert.equal((await f.fixture.get('BATCH#batch','META'))?.indexState,'blocked');
});
test('AC4/5 reactivation before blocking transaction preserves pending work',async()=>{
 const f=await actorIndexFixture(false);f.fixture.beforeTransaction=()=>{f.fixture.beforeTransaction=undefined;const row=f.fixture.rows.get(f.fixture.key('USER#owner','META'))!;f.fixture.seed({...row,active:true,version:2});};
 await assert.rejects(f.store.processIndexBatch('batch',f.embedding),{name:'TransactionCanceledException'});assert.deepEqual(f.counts(),{embeds:0,upserts:0});assert.equal((await f.fixture.get('BATCH#batch','META'))?.indexState,'pending');assert.ok(await f.fixture.get('WORK#INDEX','PENDING#batch'));
});

test.after(async()=>{if(table)for(const [id,key] of owned){await db.delete(key.pk,key.sk);owned.delete(id);writeFileSync(manifest,JSON.stringify([...owned.values()]),{mode:0o600});}client.destroy();});
