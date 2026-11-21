import {S3VectorsClient,PutVectorsCommand,QueryVectorsCommand} from '@aws-sdk/client-s3vectors';
import {BedrockRuntimeClient,InvokeModelCommand} from '@aws-sdk/client-bedrock-runtime';
import {validateVector} from './embeddings.js';
import type {EmbeddingProvider} from './types.js';

export interface IndexedVector {key:string;poolId:string;memoryId:string;revision:string;model:string;vector:number[];knowledgeSession?:string}
export interface VectorQuery {poolId:string;model:string;vector:number[];limit:number;knowledgeSessions?:string[]}
export interface VectorCandidate {memoryId:string;revision:string;score:number}
/** Candidate retrieval only. The team repository must independently authorize and load content. */
export class AwsVectors {
 constructor(private readonly client:S3VectorsClient,private readonly bucket:string,private readonly index:string,private readonly dimensions:number){
  if(!bucket||!index||!Number.isInteger(dimensions)||dimensions<1)throw Error('Invalid vector index configuration');
 }
 private vector(value:unknown){validateVector(value);if(value.length!==this.dimensions)throw Error('Embedding dimension does not match vector index');}
 async upsert(records:IndexedVector[]):Promise<void>{
  if(!Array.isArray(records)||records.length>100)throw Error('Vector batch exceeds 100');
  if(!records.length)return;
  for(const row of records){this.vector(row.vector);if(!row.key||!row.poolId||!row.model||!/^[a-f0-9]{64}$/.test(row.memoryId)||!row.revision)throw Error('Invalid vector record');}
  await this.client.send(new PutVectorsCommand({vectorBucketName:this.bucket,indexName:this.index,vectors:records.map(row=>({key:row.key,data:{float32:row.vector},metadata:{poolId:row.poolId,memoryId:row.memoryId,revision:row.revision,model:row.model,...(row.knowledgeSession?{knowledgeSession:row.knowledgeSession}:{})}}))}),{abortSignal:AbortSignal.timeout(15000)});
 }
 async query(input:VectorQuery):Promise<VectorCandidate[]>{
  this.vector(input.vector);if(!input.poolId||!input.model||!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw Error('Invalid vector query');
  const sessions=input.knowledgeSessions;
  if(sessions&&(sessions.length>1000||sessions.some(s=>!/^[a-f0-9]{64}$/.test(s))))throw Error('Invalid knowledge query scope');
  // At most 93 constraints per query, below S3 Vectors' 100-constraint limit.
  const groups=sessions===undefined?[undefined]:sessions.length?Array.from({length:Math.ceil(sessions.length/90)},(_,i)=>sessions.slice(i*90,i*90+90)):[[]];
  const responses=[];
  for(let offset=0;offset<groups.length;offset+=4)responses.push(...await Promise.all(groups.slice(offset,offset+4).map(group=>this.client.send(new QueryVectorsCommand({vectorBucketName:this.bucket,indexName:this.index,queryVector:{float32:input.vector},topK:input.limit,filter:{$and:[{poolId:{$eq:input.poolId}},{model:{$eq:input.model}},...(group===undefined?[]:[group.length?{$or:[{knowledgeSession:{$exists:false}},{knowledgeSession:{$in:group}}]}:{knowledgeSession:{$exists:false}}])]},returnMetadata:true,returnDistance:true}),{abortSignal:AbortSignal.timeout(15000)}))));
  if(responses.some(r=>r.distanceMetric!=='cosine'))throw Error('Unexpected vector distance metric');
  const response={distanceMetric:'cosine',vectors:responses.flatMap(r=>r.vectors??[]).sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity))};
  if(response.distanceMetric!=='cosine')throw Error('Unexpected vector distance metric');
  const result:VectorCandidate[]=[];const seen=new Set<string>();
  for(const row of (response.vectors??[])){
   const meta=row.metadata;if(!meta||Array.isArray(meta)||typeof meta!=='object')continue;
   if(meta.poolId!==input.poolId||meta.model!==input.model||typeof meta.memoryId!=='string'||!/^[a-f0-9]{64}$/.test(meta.memoryId)||typeof meta.revision!=='string'||!meta.revision||typeof row.distance!=='number'||!Number.isFinite(row.distance)||row.distance<0||row.distance>2)continue;
   if(sessions&&meta.knowledgeSession!==undefined&&(typeof meta.knowledgeSession!=='string'||!sessions.includes(meta.knowledgeSession)))continue;
   if(seen.has(meta.memoryId))continue;seen.add(meta.memoryId);result.push({memoryId:meta.memoryId,revision:meta.revision,score:1-row.distance});
  }
  return result.slice(0,input.limit);
 }
}
/** Titan V2 inference is explicit and metered, never a model download inside Lambda. */
export function bedrockEmbeddings(client=new BedrockRuntimeClient({maxAttempts:2}),dimensions=256):EmbeddingProvider{
 if(![256,512,1024].includes(dimensions))throw Error('Titan V2 dimensions must be 256, 512 or 1024');
 const model='amazon.titan-embed-text-v2:0';
 return{identity:`bedrock:${model}:${dimensions}:normalized`,async embed(texts){
  if(!Array.isArray(texts)||texts.length>100||texts.some(text=>typeof text!=='string'||!text.trim()||text.length>10000))throw Error('Invalid embedding batch');
  const result:number[][]=[];
  for(let offset=0;offset<texts.length;offset+=4){const vectors=await Promise.all(texts.slice(offset,offset+4).map(async inputText=>{
   const output=await client.send(new InvokeModelCommand({modelId:model,contentType:'application/json',accept:'application/json',body:JSON.stringify({inputText,dimensions,normalize:true})}),{abortSignal:AbortSignal.timeout(18000)});
   const data=JSON.parse(new TextDecoder().decode(output.body)) as {embedding?:unknown};thisVector(data.embedding,dimensions);return data.embedding;
  }));result.push(...vectors);}return result;
 }};
}
function thisVector(vector:unknown,dimensions:number):asserts vector is number[]{validateVector(vector);if(vector.length!==dimensions)throw Error('Bedrock embedding dimension mismatch');}
