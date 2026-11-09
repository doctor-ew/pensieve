import {DeleteCommand,TransactWriteCommand,type TransactWriteCommandInput} from '@aws-sdk/lib-dynamodb';
import type {AwsDatabase} from './aws-db.js';
import type {ConnectorStorage,ConnectorEntry,ConnectorRow,ConnectorTable} from './connector-storage.js';
const conditional=(error:unknown)=>error instanceof Error&&['ConditionalCheckFailedException','TransactionCanceledException'].includes(error.name);
type Actions=NonNullable<TransactWriteCommandInput['TransactItems']>;
/** Expiry is checked on every use, independent of asynchronous DynamoDB TTL cleanup. */
export class AwsConnectorStorage implements ConnectorStorage {
 constructor(private readonly db:AwsDatabase,private readonly now=Date.now){}
 private key(table:ConnectorTable,key:string){return {pk:'CONNECTOR#'+table,sk:key};}
 async get(table:ConnectorTable,key:string):Promise<ConnectorRow|undefined>{const row=await this.db.get('CONNECTOR#'+table,key);if(!row||Number(row.expiresAt)<=this.now())return;return {body:String(row.body),...(table==='connector_clients'?{}:{expires:Number(row.expiresAt)})};}
 private put(entry:ConnectorEntry):Actions[number]{const expiry=entry.row.expires??this.now()+86400000;return {Put:{TableName:this.db.table,Item:{...this.key(entry.table,entry.key),body:entry.row.body,expiresAt:expiry,ttl:Math.ceil(expiry/1000)},ConditionExpression:'attribute_not_exists(pk)'}};}
 private counter(scope:string,window:number,max:number):Actions[number]{return {Update:{TableName:this.db.table,Key:{pk:'CONNECTOR-RATE#'+scope,sk:String(window)},UpdateExpression:'SET #ttl = :ttl ADD #n :one',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':ttl':Math.ceil((this.now()+172800000)/1000),':one':1,':max':max}}};}
 private renewClient(body:string):Actions[number]{const {clientId}=JSON.parse(body) as {clientId:string};if(!clientId)throw Error('Missing connector client');return {Update:{TableName:this.db.table,Key:this.key('connector_clients',clientId),UpdateExpression:'SET expiresAt = :expiry, #ttl = :ttl',ConditionExpression:'attribute_exists(pk) AND expiresAt > :now',ExpressionAttributeNames:{'#ttl':'ttl'},ExpressionAttributeValues:{':expiry':this.now()+86400000,':ttl':Math.ceil((this.now()+86400000)/1000),':now':this.now()}}};}
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
 close():void{}
}
