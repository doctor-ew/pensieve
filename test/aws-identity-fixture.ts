import {writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,PutCommand,DeleteCommand,TransactWriteCommand,UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {S3Client,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {AwsDatabase} from '../src/aws-db.js';
export function awsIdentityFixture(){
 const table=process.env.PENSIEVE_AWS_TEST_TABLE!;if(!table)throw Error('Explicit test table required');
 const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:process.env.AWS_REGION??'us-east-1',maxAttempts:12,retryMode:'adaptive',...(process.env.PENSIEVE_AWS_TEST_ENDPOINT?{endpoint:process.env.PENSIEVE_AWS_TEST_ENDPOINT}:{})}),{marshallOptions:{removeUndefinedValues:true}});
 const journal='/tmp/pensieve-aws-identity-fixture-'+randomUUID()+'.json';const originals=new Map<string,Record<string,unknown>|undefined>();const objects=new Set<string>();const save=()=>writeFileSync(journal,JSON.stringify({table,bucket:process.env.PENSIEVE_AWS_TEST_SNAPSHOT_BUCKET,items:[...originals].map(([key,value])=>({key:JSON.parse(key),value})),objects:[...objects]}),{mode:0o600});
 const send=client.send.bind(client),prior=new Map<string,Promise<Record<string,unknown>|undefined>>();
 client.send=(async(command:unknown)=>{
  const input=(command as {input:Record<string,unknown>}).input;const keys:Record<string,unknown>[]=[];
  if(command instanceof PutCommand)keys.push({pk:command.input.Item!.pk,sk:command.input.Item!.sk});
  if(command instanceof DeleteCommand||command instanceof UpdateCommand)keys.push(command.input.Key!);
  if(command instanceof TransactWriteCommand)for(const action of command.input.TransactItems??[]){const item=action.Put?.Item,key=action.Delete?.Key??action.Update?.Key;if(item)keys.push({pk:item.pk,sk:item.sk});else if(key)keys.push(key);}
  for(const key of keys){if(key.pk==='SYSTEM')continue;const id=JSON.stringify(key);if(!prior.has(id))prior.set(id,send(new GetCommand({TableName:table,Key:key,ConsistentRead:true})).then(r=>r.Item));originals.set(id,await prior.get(id));save();}
  void input;if(keys.length)await new Promise(resolve=>setTimeout(resolve,keys.length*160));return send(command as Parameters<typeof send>[0]);
 }) as typeof client.send;
 const bucket=process.env.PENSIEVE_AWS_TEST_SNAPSHOT_BUCKET,s3=new S3Client({region:process.env.AWS_REGION??'us-east-1'}),s3send=s3.send.bind(s3);
 s3.send=(async(command:unknown)=>{if(command instanceof PutObjectCommand&&command.input.Bucket===bucket){objects.add(command.input.Key!);save();}return s3send(command as Parameters<typeof s3send>[0]);}) as typeof s3.send;
 return {db:new AwsDatabase(client,table),s3,bucket:bucket!,close:async()=>{for(const [key,value]of prior){await new Promise(resolve=>setTimeout(resolve,100));const original=await value;if(original)await send(new PutCommand({TableName:table,Item:original}));else await send(new DeleteCommand({TableName:table,Key:JSON.parse(key)}));}for(const key of objects)await s3send(new DeleteObjectCommand({Bucket:bucket,Key:key}));unlinkSync(journal);client.destroy();s3.destroy();}};
}
