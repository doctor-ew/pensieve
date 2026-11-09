import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {S3VectorsClient,DeleteVectorsCommand} from '@aws-sdk/client-s3vectors';
import {AwsVectors,bedrockEmbeddings} from '../src/aws-vectors.js';
const bucket=process.env.PENSIEVE_AWS_VECTOR_BUCKET,index=process.env.PENSIEVE_AWS_VECTOR_INDEX;
if(!bucket||!index)throw Error('Explicit vector bucket/index required');
const client=new S3VectorsClient({region:'us-east-1'}),provider=bedrockEmbeddings(undefined,256),vectors=new AwsVectors(client,bucket,index,256);
const pool='canary-'+randomBytes(8).toString('hex'),id=createHash('sha256').update(pool).digest('hex'),key=pool+'-'+id;
try{
 const [vector]=await provider.embed(['Pensieve preserves decisions and their rationale.']);
 await vectors.upsert([{key,poolId:pool,memoryId:id,revision:id,model:provider.identity,vector}]);
 const hits=await vectors.query({poolId:pool,model:provider.identity,vector,limit:8});assert.equal(hits[0]?.memoryId,id);
 assert.deepEqual(await vectors.query({poolId:pool+'-other',model:provider.identity,vector,limit:8}),[]);
 console.log('PASS: real Bedrock256 embedding, S3 Vectors upsert, recall and pool filter');
}finally{await client.send(new DeleteVectorsCommand({vectorBucketName:bucket,indexName:index,keys:[key]}));}
