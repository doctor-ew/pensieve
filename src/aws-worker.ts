import type {DynamoDBStreamEvent,DynamoDBBatchResponse} from 'aws-lambda';
import {createAwsResources} from './aws-runtime.js';
let resources:ReturnType<typeof createAwsResources>|undefined;
/** Bounded event batches with partial failure reporting. Durable records outlive the stream. */
export async function handler(event:DynamoDBStreamEvent|{kind:"reconcile"}):Promise<DynamoDBBatchResponse>{
 const failures:DynamoDBBatchResponse['batchItemFailures']=[];
 resources??=createAwsResources().catch(error=>{resources=undefined;throw error;});
 const app=await resources;
 if((await app.db.get("SYSTEM","MIGRATION"))?.state==="importing")throw Error("Migration in progress");
 if("kind" in event){const result=await app.store.reconcileIndexWork(app.provider,{limit:5});if(result.failures)throw Error(`Index reconciliation deferred ${result.failures} batches`);if(app.mailer)await app.delivery.runBatch(app.mailer,10);return{batchItemFailures:[]};}
 for(const record of event.Records){
  const sequence=record.dynamodb?.SequenceNumber;
  if(!sequence)throw Error('Missing stream sequence number');
  try{
   await app.audit.recordStream(record);
   if(record.eventName==='REMOVE')continue;
   const item=record.dynamodb?.NewImage;const pk=item?.pk?.S,sk=item?.sk?.S;
   if(!pk||!sk)throw Error('Missing work record keys');
   if(item?.kind?.S==='index-batch'&&item?.state?.S==='committed')await app.store.processIndexBatch(pk.slice('BATCH#'.length),app.provider);
   if(item?.kind?.S==='delivery-job'&&item?.state?.S==='pending'){
    if(!app.mailer)throw Error('Mailer unavailable');await app.delivery.processDeliveryJob(pk,sk,app.mailer);
   }
  }catch{failures.push({itemIdentifier:sequence});console.warn('Pensieve background work deferred');}
 }
 return{batchItemFailures:failures};
}
