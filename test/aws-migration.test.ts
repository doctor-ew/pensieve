import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DynamoDBClient,CreateTableCommand,DeleteTableCommand} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {S3Client} from '@aws-sdk/client-s3';
import {AwsDatabase} from '../src/aws-db.js';
import {AwsShareStore} from '../src/aws-share-store.js';
import {migrateAws} from '../src/aws-migrate.js';
import {TeamStore} from '../src/team-store.js';
import {ShareStore} from '../src/executive.js';
import {SqliteConnectorStorage} from '../src/connector-storage.js';
const endpoint=process.env.PENSIEVE_AWS_TEST_ENDPOINT;
const local=endpoint&&['127.0.0.1','localhost'].includes(new URL(endpoint).hostname);
test('DynamoDB Local snapshot migration preserves refresh history, revocation and client lifetime',{skip:!local},async()=>{
 const home=await mkdtemp(join(tmpdir(),'pensieve-refresh-migration-'));
 const client=new DynamoDBClient({region:'us-east-1',endpoint,credentials:{accessKeyId:'local',secretAccessKey:'local'}});
 const document=DynamoDBDocumentClient.from(client),name='refresh-migration-'+randomBytes(8).toString('hex');
 let created=false;
 try{
  await client.send(new CreateTableCommand({TableName:name,KeySchema:[{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}],AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'},{AttributeName:'sk',AttributeType:'S'}],BillingMode:'PAY_PER_REQUEST'}));created=true;
  const team=new TeamStore(join(home,'team.sqlite'));team.createUser('Migration fixture');team.close();new ShareStore(join(home,'team-shares.sqlite')).close();
  const storage=new SqliteConnectorStorage(join(home,'connector.sqlite')),now=Date.now(),expires=now+30*86400000;
  await storage.registerClient({table:'connector_clients',key:'migration-client',row:{body:JSON.stringify({client_id:'migration-client',client_id_issued_at:Math.floor(now/1000),grant_types:['authorization_code','refresh_token']})}},now);
  const records=[
   {table:'connector_families' as const,key:'family-hash',row:{body:JSON.stringify({clientId:'migration-client',currentRefresh:'refresh-hash',currentAccess:'access-hash'}),expires}},
   {table:'connector_refresh' as const,key:'refresh-hash',row:{body:JSON.stringify({clientId:'migration-client',familyId:'family-hash'}),expires}},
   {table:'connector_revocations' as const,key:'family-hash',row:{body:'{}',expires}}
  ];
  for(const entry of records)await storage.insert(entry);storage.close();
  const db=new AwsDatabase(document,name),shares=new AwsShareStore(db,{send:async()=>{throw Error('Unexpected snapshot write');}} as unknown as S3Client,'unused');
  const result=await migrateAws(home,db,shares,async()=>{});assert.equal(result.state,'ready');
  for(const entry of records){const row=await db.get('CONNECTOR#'+entry.table,entry.key);assert.equal(row?.body,entry.row.body);assert.equal(row?.expiresAt,expires);}
  assert.ok(Number((await db.get('CONNECTOR#connector_clients','migration-client'))?.expiresAt)>=expires);
  assert.deepEqual(await migrateAws(home,db,shares,async()=>{}),result);
 }finally{if(created)await client.send(new DeleteTableCommand({TableName:name}));document.destroy();await rm(home,{recursive:true,force:true});}
});
