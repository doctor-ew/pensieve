import {LambdaClient,GetFunctionConcurrencyCommand} from '@aws-sdk/client-lambda';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {S3Client} from '@aws-sdk/client-s3';
import {AwsDatabase} from '../src/aws-db.js';
import {AwsShareStore} from '../src/aws-share-store.js';
import {migrateAws} from '../src/aws-migrate.js';
const table=process.env.PENSIEVE_AWS_TABLE,bucket=process.env.PENSIEVE_AWS_SNAPSHOT_BUCKET,home=process.argv[2];
if(!table||!bucket||!home)throw Error('Explicit table, snapshot bucket and frozen backup directory required');
const db=new AwsDatabase(DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:12,retryMode:'adaptive'}),{marshallOptions:{removeUndefinedValues:true}}),table);
const lambda=new LambdaClient({});
const assertQuiescent=async()=>{
 for(const name of [process.env.PENSIEVE_AWS_API_FUNCTION,process.env.PENSIEVE_AWS_WORKER_FUNCTION]){
  if(!name)throw Error('Explicit API and worker function names required for maintenance check');
  const result=await lambda.send(new GetFunctionConcurrencyCommand({FunctionName:name}));if(result.ReservedConcurrentExecutions!==0)throw Error('Set API and worker concurrency to zero and drain invocations before importing');
 }
};
await assertQuiescent();
console.log('Maintenance verified; waiting 125 seconds to drain previously admitted invocations');
await new Promise(resolve=>setTimeout(resolve,125000));
console.log(JSON.stringify(await migrateAws(home,db,new AwsShareStore(db,new S3Client({}),bucket),assertQuiescent),null,2));
