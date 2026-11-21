import test from 'node:test';
import assert from 'node:assert/strict';
import {S3VectorsClient,QueryVectorsCommand} from '@aws-sdk/client-s3vectors';
import {BedrockRuntimeClient} from '@aws-sdk/client-bedrock-runtime';
import {AwsVectors,bedrockEmbeddings} from '../src/aws-vectors.js';
test('vector adapter scopes candidates and discards foreign or malformed metadata',async()=>{
 let request:unknown;
 const client={send:async(command:QueryVectorsCommand)=>{request=command.input;return{distanceMetric:'cosine',vectors:[{distance:0.2,metadata:{poolId:'p',model:'m',memoryId:'a'.repeat(64),revision:'r'}},{distance:0,metadata:{poolId:'foreign',model:'m',memoryId:'b'.repeat(64),revision:'r'}},{distance:NaN,metadata:{poolId:'p',model:'m',memoryId:'c'.repeat(64),revision:'r'}}]};}} as unknown as S3VectorsClient;
 const adapter=new AwsVectors(client,'bucket','index',2);
 assert.deepEqual(await adapter.query({poolId:'p',model:'m',vector:[1,0],limit:8}),[{memoryId:'a'.repeat(64),revision:'r',score:0.8}]);
 assert.deepEqual((request as {filter:unknown}).filter,{$and:[{poolId:{$eq:'p'}},{model:{$eq:'m'}}]});
 await assert.rejects(adapter.query({poolId:'p',model:'m',vector:[1],limit:8}),/dimension/);
});
test('embedding adapter bounds concurrency, validates dimensions, and preserves input order',async()=>{
 let active=0,max=0;
 const client={send:async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return{body:Buffer.from(JSON.stringify({embedding:Array(256).fill(1)}))};}} as unknown as BedrockRuntimeClient;
 const provider=bedrockEmbeddings(client);const rows=await provider.embed(Array(9).fill('decision'));
 assert.equal(rows.length,9);assert.ok(max<=4);assert.match(provider.identity,/:256:normalized$/);
 const invalid=bedrockEmbeddings({send:async()=>({body:Buffer.from('{"embedding":[1]}')})} as unknown as BedrockRuntimeClient);
 await assert.rejects(invalid.embed(['text']),/dimension/);
});
test('repository vector queries restrict active snapshots and split large scopes below filter limits',async()=>{
 const requests:QueryVectorsCommand['input'][]=[];
 const session='a'.repeat(64);
 const client={send:async(command:QueryVectorsCommand)=>{requests.push(command.input);return {distanceMetric:'cosine',vectors:[
  {distance:0.1,metadata:{poolId:'p',model:'m',memoryId:'b'.repeat(64),revision:'r',knowledgeSession:'obsolete'}},
  {distance:0.2,metadata:{poolId:'p',model:'m',memoryId:'c'.repeat(64),revision:'r',knowledgeSession:session}},
  {distance:0.3,metadata:{poolId:'p',model:'m',memoryId:'d'.repeat(64),revision:'r'}}
 ]};}} as unknown as S3VectorsClient;
 const adapter=new AwsVectors(client,'bucket','index',2);
 const sessions=[session,...Array.from({length:94},(_,i)=>i.toString(16).padStart(64,'0'))];
 const result=await adapter.query({poolId:'p',model:'m',vector:[1,0],limit:8,knowledgeSessions:sessions});
 assert.equal(requests.length,2);assert.deepEqual(result.map(r=>r.memoryId),['c'.repeat(64),'d'.repeat(64)]);
 assert.match(JSON.stringify(requests[0].filter),/knowledgeSession/);
 requests.length=0;await adapter.query({poolId:'p',model:'m',vector:[1,0],limit:8,knowledgeSessions:[]});
 assert.deepEqual(requests[0].filter,{$and:[{poolId:{$eq:'p'}},{model:{$eq:'m'}},{knowledgeSession:{$exists:false}}]});
});
