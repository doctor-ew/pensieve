import {createHash,randomUUID} from 'node:crypto';
import {QueryCommand} from '@aws-sdk/lib-dynamodb';
import type {DynamoDBRecord,AttributeValue} from 'aws-lambda';
import {AwsDatabase} from './aws-db.js';

/** Administrative activity metadata is retained for 30 days, never conversation bodies or credentials. */
export const AUDIT_RETENTION_DAYS=30;
export const AUDIT_ACTIONS=[
 'user.created','user.suspended','user.reactivated','pool.created','pool.open',
 'memory.created','memory.updated','memory.list','memory.search','memory.export',
 'share.created','share.revoked','share.open','share.download','share.search',
 'session.signin','session.logout','email.queued','email.sent','email.unknown','email.failed',
 'index.queued','index.completed','index.blocked','index.failed',
 'admin.open','admin.audit.viewed','admin.user.list','admin.user.create','admin.user.suspend',
 'admin.user.reactivate','admin.membership.grant','admin.share.revoke','admin.identity','admin.denied'
] as const;
export type AuditAction=typeof AUDIT_ACTIONS[number];
export type AuditOutcome='attempt'|'success'|'denied'|'failed'|'unknown'|'queued'|'blocked'|'cancelled';
export interface AuditDetails {count?:number;resultCount?:number;durationMs?:number;bytes?:number;statusCode?:number;source?:'browser'|'mcp'|'cli'|'stream'|'system'}
export interface AuditInput {id?:string;action:AuditAction;actorId?:string;targetId?:string;poolId?:string;outcome?:AuditOutcome;details?:AuditDetails}
export interface AuditEvent {id:string;at:string;action:AuditAction;actorId?:string;targetId?:string;poolId?:string;outcome?:AuditOutcome;details?:AuditDetails}
export interface AuditPage {events:AuditEvent[];nextCursor?:string}
const outcomes=new Set<AuditOutcome>(['attempt','success','denied','failed','unknown','queued','blocked','cancelled']);
const sources=new Set(['browser','mcp','cli','stream','system']);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function identifier(value:unknown):string|undefined {
 if(value===undefined)return;
 if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(value))throw Error('Invalid audit identifier');
 return value;
}
function safeDetails(input:unknown):AuditDetails|undefined {
 if(input===undefined)return;
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid audit details');
 const value=input as Record<string,unknown>,result:AuditDetails={};
 for(const key of ['count','resultCount','durationMs','bytes','statusCode'] as const){
  const n=value[key];if(n===undefined)continue;
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER||(key==='statusCode'&&(!Number.isInteger(n)||n<100||n>599)))throw Error('Invalid audit measurement');
  result[key]=n;
 }
 if(value.source!==undefined){if(typeof value.source!=='string'||!sources.has(value.source))throw Error('Invalid audit source');result.source=value.source as AuditDetails['source'];}
 return Object.keys(result).length?result:undefined;
}
function metadata(input:AuditInput):Omit<AuditEvent,'id'|'at'> {
 if(!AUDIT_ACTIONS.includes(input.action))throw Error('Invalid audit action');
 if(input.outcome!==undefined&&!outcomes.has(input.outcome))throw Error('Invalid audit outcome');
 const actorId=identifier(input.actorId),targetId=identifier(input.targetId),poolId=identifier(input.poolId),details=safeDetails(input.details);
 return {action:input.action,...(actorId?{actorId}:{}),...(targetId?{targetId}:{}),...(poolId?{poolId}:{}),...(input.outcome?{outcome:input.outcome}:{}),...(details?{details}:{})};
}
function dayValue(day:unknown):string {
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid audit day');
 const timestamp=Date.parse(day+'T00:00:00.000Z');if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==day)throw Error('Invalid audit day');return day;
}
function cursorValue(cursor:unknown,day:string):string|undefined {
 if(cursor===undefined)return;
 if(typeof cursor!=='string'||cursor.length>256||!/^[a-zA-Z0-9_-]+$/.test(cursor))throw Error('Invalid audit cursor');
 let value:unknown;try{const raw=Buffer.from(cursor,'base64url');if(raw.toString('base64url')!==cursor)throw Error();value=JSON.parse(raw.toString('utf8'));}catch{throw Error('Invalid audit cursor');}
 const v=value as {day?:unknown;sk?:unknown};
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='day,sk'||v.day!==day||typeof v.sk!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z#[a-f0-9]{64}$/.test(v.sk)||!v.sk.startsWith(day+'T'))throw Error('Invalid audit cursor');
 const timestamp=Date.parse(v.sk.slice(0,24));if(!Number.isFinite(timestamp)||new Date(timestamp).toISOString()!==v.sk.slice(0,24))throw Error('Invalid audit cursor');return v.sk;
}
const text=(image:Record<string,AttributeValue>|undefined,key:string)=>image?.[key]?.S;
const bool=(image:Record<string,AttributeValue>|undefined,key:string)=>image?.[key]?.BOOL;
const numeric=(image:Record<string,AttributeValue>|undefined,key:string)=>image?.[key]?.N===undefined?undefined:Number(image[key].N);
export class AwsAudit {
 constructor(readonly db:AwsDatabase,private readonly now:()=>number=Date.now){}
 async record(input:AuditInput):Promise<void>{await this.recordAt(input,this.now());}
 private async recordAt(input:AuditInput,timestamp:number):Promise<void>{
  if(!Number.isFinite(timestamp))throw Error('Invalid audit timestamp');
  if(input.id!==undefined&&(typeof input.id!=='string'||!input.id.length||input.id.length>512))throw Error('Invalid audit event id');
  const body=metadata(input),id=digest(input.id??randomUUID()),at=new Date(timestamp).toISOString(),pk='AUDIT#'+at.slice(0,10),sk=at+'#'+id;
  const ttl=Math.floor(timestamp/1000)+AUDIT_RETENTION_DAYS*86400;
  // Never resurrect expired stream records or return them while DynamoDB TTL deletion catches up.
  if(ttl<=Math.floor(this.now()/1000))return;
  const fingerprint=digest(JSON.stringify(body));
  try{await this.db.transact([
   this.db.putAction({pk:'AUDIT-ID#'+id,sk:'META',fingerprint,eventPk:pk,eventSk:sk,ttl},'attribute_not_exists(pk)'),
   this.db.putAction({pk,sk,...body,id,at,ttl},'attribute_not_exists(pk)')
  ]);}catch(error){
   if(!(error instanceof Error)||error.name!=='TransactionCanceledException')throw error;
   const prior=await this.db.get('AUDIT-ID#'+id,'META');
   if(!prior||prior.fingerprint!==fingerprint){if(prior)throw Error('Audit event identifier conflict');throw error;}
  }
 }
 async page(options:{day:string;cursor?:string;limit?:number}):Promise<AuditPage>{
  const day=dayValue(options.day),limit=options.limit??50,after=cursorValue(options.cursor,day);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Audit page limit must be 1..100');
  const pk='AUDIT#'+day,now=Math.floor(this.now()/1000);
  const result=await this.db.client.send(new QueryCommand({TableName:this.db.table,ConsistentRead:true,KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk,':now':now},FilterExpression:'#ttl>:now',ExpressionAttributeNames:{'#ttl':'ttl'},ScanIndexForward:false,Limit:limit,...(after?{ExclusiveStartKey:{pk,sk:after}}:{})}));
  const events=(result.Items??[]).filter(row=>Number(row.ttl)>now).map(row=>{
   if(typeof row.id!=='string'||!/^[a-f0-9]{64}$/.test(row.id)||typeof row.at!=='string')throw Error('Invalid stored audit record');
   return {id:row.id,at:row.at,...metadata(row as unknown as AuditInput)};
  });
  const next=result.LastEvaluatedKey?.sk;
  return {events,...(typeof next==='string'?{nextCursor:Buffer.from(JSON.stringify({day,sk:next})).toString('base64url')}:{})};
 }
 private async projectUser(image:Record<string,AttributeValue>):Promise<void>{
  const pk=text(image,'pk')!,id=identifier(pk.slice('USER#'.length))!,name=text(image,'name'),active=bool(image,'active'),version=numeric(image,'version');
  if(typeof name!=='string'||!name.trim()||name.length>160||typeof active!=='boolean'||!Number.isSafeInteger(version)||Number(version)<1)throw Error('Invalid user activity metadata');
  try{await this.db.put({pk:'ADMIN#USERS',sk:'USER#'+id,id,name,active,version},'attribute_not_exists(pk) OR version < :version',{':version':version});}
  catch(error){if(!(error instanceof Error)||error.name!=='ConditionalCheckFailedException')throw error;}
 }
 async recordStream(record:DynamoDBRecord):Promise<void>{
  if(record.eventName!=='INSERT'&&record.eventName!=='MODIFY')return;
  const image=record.dynamodb?.NewImage,old=record.dynamodb?.OldImage,pk=text(image,'pk'),sk=text(image,'sk');
  if(!pk||!sk)return;
  let event:Omit<AuditInput,'id'>|undefined;
  if(pk.startsWith('USER#')&&sk==='META'){
   await this.projectUser(image!);const id=pk.slice(5),active=bool(image,'active'),previous=bool(old,'active');
   if(record.eventName==='INSERT')event={action:'user.created',targetId:id,outcome:'success'};
   else if(previous===true&&active===false)event={action:'user.suspended',targetId:id,outcome:'success'};
   else if(previous===false&&active===true)event={action:'user.reactivated',targetId:id,outcome:'success'};
  }else if(pk.startsWith('POOL#')&&sk==='META'&&record.eventName==='INSERT'){
   event={action:'pool.created',actorId:text(image,'owner'),targetId:pk.slice(5),poolId:pk.slice(5),outcome:'success'};
  }else if(pk.startsWith('POOL#')&&sk.startsWith('MEMORY#')){
   if(record.eventName==='INSERT'||text(image,'revision')!==text(old,'revision'))event={action:record.eventName==='INSERT'?'memory.created':'memory.updated',actorId:text(image,'contributorId'),targetId:sk.slice(7),poolId:pk.slice(5),outcome:'queued'};
  }else if(pk.startsWith('SHARE#')&&sk==='META'){
   if(record.eventName==='INSERT')event={action:'share.created',actorId:text(image,'creatorId'),targetId:pk.slice(6),poolId:text(image,'poolId'),outcome:'success'};
   else if(bool(old,'revoked')===false&&bool(image,'revoked')===true)event={action:'share.revoked',targetId:pk.slice(6),poolId:text(image,'poolId'),outcome:'success'};
  }else if(pk.startsWith('DELIVERY#')){
   const state=text(image,'state');if(record.eventName==='INSERT'||state!==text(old,'state')){
    const action:Partial<Record<string,AuditAction>>={pending:'email.queued',sent:'email.sent',unknown:'email.unknown',failed:'email.failed',cancelled:'email.failed'};
    if(state&&action[state])event={action:action[state]!,actorId:text(image,'actor'),targetId:text(image,'share')??pk.slice(9),outcome:state==='pending'?'queued':state==='sent'?'success':state==='unknown'?'unknown':state==='cancelled'?'cancelled':'failed'};
   }
  }else if(pk.startsWith('SESSION#')&&sk==='META'&&record.eventName==='INSERT'){
   // Deliberately exclude the session key/digest, identity claims, and email from the event.
   event={action:'session.signin',actorId:text(image,'actor'),outcome:'success'};
  }else if(pk.startsWith('BATCH#')&&sk==='META'&&text(image,'kind')==='index-batch'&&text(image,'state')==='committed'){
   const state=text(image,'indexState'),previous=text(old,'indexState');
   if(record.eventName==='INSERT'||state!==previous||text(old,'state')!=='committed'){
    const action:Partial<Record<string,AuditAction>>={pending:'index.queued',ready:'index.completed',blocked:'index.blocked',failed:'index.failed'};
    if(state&&action[state])event={action:action[state]!,actorId:text(image,'actor'),targetId:pk.slice(6),poolId:text(image,'poolId'),outcome:state==='pending'?'queued':state==='ready'?'success':state==='blocked'?'blocked':'failed'};
   }
  }
  if(!event)return;
  const created=record.dynamodb?.ApproximateCreationDateTime;
  if(!record.eventID||record.eventID.length>480||typeof created!=='number'||!Number.isFinite(created))throw Error('Missing stream audit identity or timestamp');
  await this.recordAt({...event,id:'stream:'+record.eventID,details:{source:'stream'}},created*1000);
 }
}
