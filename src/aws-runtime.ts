import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {S3Client} from '@aws-sdk/client-s3';
import {S3VectorsClient} from '@aws-sdk/client-s3vectors';
import {SSMClient,GetParameterCommand} from '@aws-sdk/client-ssm';
import {AwsAudit} from './aws-audit.js';
import {createAwsAdmin} from './aws-admin.js';
import {httpAudit} from './aws-http-audit.js';
import {AwsDatabase} from './aws-db.js';
import {AwsTeamStore} from './aws-team-store.js';
import {AwsShareStore} from './aws-share-store.js';
import {AwsLoginStates,AwsHostedSessions} from './aws-sessions.js';
import {AwsConnectorStorage} from './aws-connector-storage.js';
import {AwsDeliveryLedger} from './aws-delivery.js';
import {AwsVectors,bedrockEmbeddings} from './aws-vectors.js';
import {cognitoFromEnv} from './cognito.js';
import {createTeamServer} from './team-server.js';
import {createConnectorApp,isConnectorPath} from './agent-server.js';
import {sesMailerFromEnv} from './ses-mailer.js';
import {verificationGuard} from './verification-guard.js';
const required=(name:string)=>{const value=process.env[name];if(!value)throw Error(`${name} required`);return value;};
export async function createAwsResources(){
 const db=new AwsDatabase(DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:10,retryMode:'adaptive'}),{marshallOptions:{removeUndefinedValues:true}}),required('PENSIEVE_AWS_TABLE'));
 const audit=new AwsAudit(db);
 const provider=bedrockEmbeddings(undefined,Number(process.env.PENSIEVE_EMBEDDING_DIMENSIONS??256));
 const vectors=new AwsVectors(new S3VectorsClient({maxAttempts:3}),required('PENSIEVE_AWS_VECTOR_BUCKET'),required('PENSIEVE_AWS_VECTOR_INDEX'),Number(process.env.PENSIEVE_EMBEDDING_DIMENSIONS??256));
 const shares=new AwsShareStore(db,new S3Client({maxAttempts:3}),required('PENSIEVE_AWS_SNAPSHOT_BUCKET'));
 const store=await AwsTeamStore.open(db,{vectors,prepareSnapshot:input=>shares.prepareSnapshot(input)});
 const sessions=new AwsHostedSessions(db),delivery=new AwsDeliveryLedger(db,shares,store);
 return{db,store,shares,sessions,delivery,provider,audit,mailer:sesMailerFromEnv()};
}
export async function createAwsRuntime(){
 const resources=await createAwsResources();const {db,store,shares,sessions,delivery,provider,audit,mailer}=resources;
 const publicUrl=required('PENSIEVE_PUBLIC_URL');
 const parameter=required('PENSIEVE_OWNER_TOKEN_PARAMETER');
 const ownerToken=(await new SSMClient({maxAttempts:2}).send(new GetParameterCommand({Name:parameter,WithDecryption:true}))).Parameter?.Value;
 if(!ownerToken||ownerToken.length<32)throw Error('Operator credential unavailable');
 const connector=createConnectorApp(store,{publicUrl,statePath:':memory:',provider,storage:new AwsConnectorStorage(db),sessionUser:async cookie=>{
  const token=/(?:^|;\s*)pensieve_session=([a-f0-9]{64})(?:;|$)/.exec(cookie??'')?.[1];if(!token)return;const session=await sessions.get(token);return session?store.getUser(session.userId):undefined;
 }});
 const verification=verificationGuard(undefined,{check:(action,address,scope)=>delivery.checkVerification(action,address,scope??'')});
 const admin=createAwsAdmin({db,sessions,store,shares,audit,issuer:required('PENSIEVE_COGNITO_ISSUER'),publicUrl});
 const server=createTeamServer(store,{ownerToken,publicUrl,provider,maxMemoryBatch:16,maintenance:async()=>(await db.get('SYSTEM','MIGRATION'))?.state==='importing',shareStore:shares,sessionStore:sessions,cognito:cognitoFromEnv(publicUrl,new AwsLoginStates(db)),delivery,mailer,verification,handleExtra:async(req,res)=>{
  if(await admin.handle(req,res))return true;
  if(!isConnectorPath(new URL(req.url??'/',publicUrl).pathname))return false;connector.app(req,res);return true;
 }});
 return{...resources,server,observe:httpAudit(audit,sessions,store),close:()=>{connector.close();server.close();}};
}
