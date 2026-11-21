import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {AwsDatabase} from '../src/aws-db.js';
import {AwsTeamStore,type AwsVectorRecord} from '../src/aws-team-store.js';
import {AwsRepositoryRecords} from '../src/repository-records.js';
import {RepositoryService} from '../src/repository-service.js';
import {activeKnowledgeSessions} from '../src/repository-knowledge.js';
const endpoint=process.env.PENSIEVE_REPOSITORY_TEST_ENDPOINT;
test('DynamoDB atomically publishes repository manifests and verifies vector receipts',{skip:!endpoint},async()=>{
 assert.equal(new URL(endpoint!).hostname,'127.0.0.1','This test only writes to disposable local DynamoDB');
 const client=new DynamoDBClient({endpoint,region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'}});
 try{
  const db=new AwsDatabase(DynamoDBDocumentClient.from(client,{marshallOptions:{removeUndefinedValues:true}}),'repository_test'),records=new AwsRepositoryRecords(db),vectors=new Map<string,AwsVectorRecord>();
  const provider={identity:'synthetic-aws-repository-test',embed:async(texts:string[])=>texts.map(()=>[1,0])};
  const teams=await AwsTeamStore.open(db,{knowledgeSessions:pool=>activeKnowledgeSessions(records,pool),vectors:{upsert:async rows=>{for(const row of rows)vectors.set(row.key,row);},query:async input=>[...vectors.values()].filter(v=>v.poolId===input.poolId&&v.model===input.model&&(!v.knowledgeSession||input.knowledgeSessions?.includes(v.knowledgeSession))).map(v=>({memoryId:v.memoryId,revision:v.revision,score:0.9}))}});
  const service=new RepositoryService(teams,records,{put:async()=>{throw Error('No source blobs required');},get:async()=>{throw Error('No source blobs required');}},provider);
  const {user}=await teams.createUser('Synthetic repository producer '+randomUUID()),pool=await teams.createPool(user.id,'Synthetic repository','private');
  const repo=await service.create(user.id,{poolId:pool.id,name:'AWS fixture',source:{kind:'upload'},autoRefresh:false});
  const first=await service.publications.begin(user.id,repo.id,'a'.repeat(40)),loser=await service.publications.begin(user.id,repo.id,'b'.repeat(40));
  const body={text:'Synthetic function double returns twice its input.',source:'manual' as const,session:first.publicationId,role:'user' as const,timestamp:'',locator:'math.ts:L1',project:'pensieve-repository:'+repo.id,citations:[`pensieve-code://${repo.id}/math.ts?rev=${'a'.repeat(40)}#L1`]};
  const memory={...body,id:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
  await service.publications.append(user.id,first.publicationId,[memory]);
  const receipt=await service.publications.finish(user.id,first.publicationId);assert.equal(receipt.indexing,'queued');
  await assert.rejects(service.publications.finish(user.id,loser.publicationId),/changed/);
  const current=await service.authorized(user.id,repo.id),mirror=await records.list('pool:'+pool.id);assert.deepEqual(mirror.items[0].value,current.value);
  assert.equal((await service.status(user.id,repo.id)).knowledge?.indexing,'pending');
  const stored=await db.get('POOL#'+pool.id,'MEMORY#'+memory.id);await teams.processIndexBatch(String(stored!.batchId),provider);
  assert.equal((await service.status(user.id,repo.id)).knowledge?.indexing,'complete');assert.equal((await teams.search(user.id,pool.id,'twice',provider))[0].id,memory.id);
  const rollback=await records.compareAndSetMany([
   {key:'repo:'+repo.id,partition:'pool:'+pool.id,expected:current.revision,value:{...current.value,name:'Must roll back'}},
   {key:'publication:'+first.publicationId,partition:'publications:'+repo.id,expected:999,value:{}}
  ]);assert.equal(rollback,false);assert.equal((await service.authorized(user.id,repo.id)).value.name,'AWS fixture');
 }finally{client.destroy();}
});
