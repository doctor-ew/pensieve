import {DeleteCommand,PutCommand,TransactWriteCommand,type TransactWriteCommandInput} from '@aws-sdk/lib-dynamodb';
import type {AwsDatabase} from './aws-db.js';
import type {ConnectorStorage,ConnectorEntry,ConnectorRow,ConnectorTable,ConnectorCheck} from './connector-storage.js';
const conditional=(error:unknown)=>error instanceof Error&&['ConditionalCheckFailedException','TransactionCanceledException'].includes(error.name);
const conflict=(error:unknown)=>error instanceof Error&&(error.name==='TransactionConflictException'||(error.name==='TransactionCanceledException'&&(error as {CancellationReasons?:{Code?:string}[]}).CancellationReasons?.some(r=>r.Code==='TransactionConflict')));
const contentionDelay=()=>new Promise<void>(resolve=>setTimeout(resolve,20+Math.floor(Math.random()*30)));
type Actions=NonNullable<TransactWriteCommandInput['TransactItems']>;
/** Expiry is checked on every use, independent of asynchronous DynamoDB TTL cleanup. */
export class AwsConnectorStorage implements ConnectorStorage {
 constructor(private readonly db:AwsDatabase,private readonly now=Date.now){}
 private key(table:ConnectorTable,key:string){return {pk:'CONNECTOR#'+table,sk:key};}
 async get(table:ConnectorTable,key:string):Promise<ConnectorRow|undefined>{const row=await this.db.get('CONNECTOR#'+table,key);if(!row||Number(row.expiresAt)<=this.now())return;return {body:String(row.body),...(table==='connector_clients'?{}:{expires:Number(row.expiresAt)})};}
 private put(entry:ConnectorEntry):Actions[number]{const refresh=entry.table==='connector_clients'&&(JSON.parse(entry.row.body).grant_types??[]).includes('refresh_token');const expiry=entry.row.expires??this.now()+(refresh?31:1)*86400000;return {Put:{TableName:this.db.table,Item:{...this.key(entry.table,entry.key),body:entry.row.body,expiresAt:expiry,ttl:Math.ceil(expiry/1000)},ConditionExpression:'attribute_not_exists(pk)'}};}
 private counter(scope:string,window:number,max:number):Actions[number]{return {Update:{TableName:this.db.table,Key:{pk:'CONNECTOR-RATE#'+scope,sk:String(window)},UpdateExpression:'SET #ttl = :ttl ADD #n :one',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':ttl':Math.ceil((this.now()+172800000)/1000),':one':1,':max':max}}};}
 private renewClient(body:string):Actions[number]{const {clientId,refreshEnabled}=JSON.parse(body) as {clientId:string;refreshEnabled?:boolean};if(!clientId)throw Error('Missing connector client');const expiry=this.now()+(refreshEnabled?31:1)*86400000;return {Update:{TableName:this.db.table,Key:this.key('connector_clients',clientId),UpdateExpression:'SET expiresAt = :expiry, #ttl = :ttl',ConditionExpression:'attribute_exists(pk) AND expiresAt > :now',ExpressionAttributeNames:{'#ttl':'ttl'},ExpressionAttributeValues:{':expiry':expiry,':ttl':Math.ceil(expiry/1000),':now':this.now()}}};}
 async insert(entry:ConnectorEntry,limit?:number):Promise<void>{const actions:Actions=[this.put(entry)];if(entry.table!=='connector_clients')actions.push(this.renewClient(entry.row.body));if(limit!==undefined)actions.push(this.counter(entry.table,Math.floor(this.now()/300000),limit));await this.db.client.send(new TransactWriteCommand({TransactItems:actions}));}
 async registerClient(entry:ConnectorEntry,now:number):Promise<void>{
  try{await this.db.client.send(new TransactWriteCommand({TransactItems:[this.counter('registrations-minute',Math.floor(now/60000),100),this.counter('registrations-day',Math.floor(now/86400000),1000),this.put(entry)]}));}
  catch(error){if(conditional(error))throw Error('Connector registration capacity reached; try again later');throw error;}
 }
 async prune(_now:number):Promise<void>{/* TTL removes expired rows; readers enforce expiry immediately. */}
 async consume(entry:ConnectorEntry,now:number,next?:ConnectorEntry):Promise<boolean>{
  const actions:Actions=[{Delete:{TableName:this.db.table,Key:this.key(entry.table,entry.key),ConditionExpression:'body = :body AND expiresAt > :now',ExpressionAttributeValues:{':body':entry.row.body,':now':now}}}];
  if(next)actions.push(this.put(next),this.renewClient(next.row.body));
  try{await this.db.client.send(new TransactWriteCommand({TransactItems:actions}));return true;}catch(error){if(conditional(error))return false;throw error;}
 }
 async remove(table:ConnectorTable,key:string,body:string):Promise<void>{try{await this.db.client.send(new DeleteCommand({TableName:this.db.table,Key:this.key(table,key),ConditionExpression:'body = :body',ExpressionAttributeValues:{':body':body}}));}catch(error){if(!conditional(error))throw error;}}
 async transact(checks:ConnectorCheck[],writes:ConnectorEntry[],deletes:ConnectorEntry[],now:number):Promise<boolean>{
  const actions:Actions=[];const handled=new Set<string>();const id=(entry:{table:ConnectorTable;key:string})=>entry.table+':'+entry.key;
  const condition=(check:ConnectorCheck)=>check.row?{ConditionExpression:'body = :body AND expiresAt = :expires AND expiresAt > :now',ExpressionAttributeValues:{':body':check.row.body,':expires':check.row.expires!,':now':now}}:{ConditionExpression:'attribute_not_exists(pk) OR expiresAt <= :now',ExpressionAttributeValues:{':now':now}};
  for(const entry of writes){const action=this.put(entry);const check=checks.find(c=>id(c)===id(entry));if(check){Object.assign(action.Put!,condition(check));handled.add(id(check));}actions.push(action);}
  for(const entry of deletes){const check=checks.find(c=>id(c)===id(entry));if(!check?.row)throw Error('Connector deletion requires an existing-row check');actions.push({Delete:{TableName:this.db.table,Key:this.key(entry.table,entry.key),...condition(check)}});handled.add(id(check));}
  for(const check of checks)if(!handled.has(id(check)))actions.push({ConditionCheck:{TableName:this.db.table,Key:this.key(check.table,check.key),...condition(check)}});
  const family=writes.find(e=>e.table==='connector_families');if(family)actions.push(this.renewClient(family.row.body));
  for(;;)try{await this.db.client.send(new TransactWriteCommand({TransactItems:actions}));return true;}catch(error){
   const reasons=(error as {CancellationReasons?:{Code?:string}[]}).CancellationReasons;
   if(error instanceof Error&&(error.name==='ConditionalCheckFailedException'||(error.name==='TransactionCanceledException'&&reasons?.some(r=>r.Code==='ConditionalCheckFailed')&&reasons.every(r=>!r.Code||['None','ConditionalCheckFailed','TransactionConflict'].includes(r.Code)))))return false;
   if(conflict(error)&&(!reasons||reasons.every(r=>!r.Code||['None','TransactionConflict'].includes(r.Code)))){
    if(checks.some(c=>c.row&&(c.row.expires??0)<=this.now()))return false;
    await contentionDelay();continue;
   }
   throw error;
  }
 }
 async revokeFamily(key:string,expires:number):Promise<void>{while(expires>this.now())try{await this.db.client.send(new PutCommand({TableName:this.db.table,Item:{...this.key('connector_revocations',key),body:'{}',expiresAt:expires,ttl:Math.ceil(expires/1000)},ConditionExpression:'attribute_not_exists(pk)'}));return;}catch(error){if(error instanceof Error&&error.name==='ConditionalCheckFailedException')return;if(!conflict(error))throw error;await contentionDelay();}}
 close():void{}
}
