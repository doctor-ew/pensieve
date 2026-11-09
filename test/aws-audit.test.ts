import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryCommand,type QueryCommandInput,type DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import type {DynamoDBRecord,AttributeValue} from 'aws-lambda';
import {AwsDatabase,type AwsItem,type AwsWrite} from '../src/aws-db.js';
import {AwsAudit,AUDIT_RETENTION_DAYS,type AuditDetails} from '../src/aws-audit.js';

/** SDK-shaped fixture proves emitted requests and failures; no AWS account access. */
class AuditFixture extends AwsDatabase {
 readonly rows:Map<string,AwsItem>;readonly queries:QueryCommandInput[];failWrite=false;
 constructor(){
  const rows=new Map<string,AwsItem>(),queries:QueryCommandInput[]=[];
  const client={send:async(command:unknown)=>{
   assert.ok(command instanceof QueryCommand);const input=command.input;queries.push(input);
   assert.equal(input.ScanIndexForward,false);assert.equal(input.ConsistentRead,true);assert.equal(input.KeyConditionExpression,'pk=:pk');
   const all=[...rows.values()].filter(r=>r.pk===input.ExpressionAttributeValues?.[':pk']&&(!input.ExclusiveStartKey||r.sk<String(input.ExclusiveStartKey.sk))).sort((a,b)=>b.sk.localeCompare(a.sk));
   const examined=all.slice(0,input.Limit),items=examined.filter(r=>Number(r.ttl)>Number(input.ExpressionAttributeValues?.[':now']));
   const last=examined.at(-1);return {Items:items,...(last&&all.length>examined.length?{LastEvaluatedKey:{pk:last.pk,sk:last.sk}}:{})};
  }} as unknown as DynamoDBDocumentClient;
  super(client,'unit-audit');this.rows=rows;this.queries=queries;
 }
 key(pk:string,sk:string){return JSON.stringify([pk,sk]);}
 override async get<T extends AwsItem=AwsItem>(pk:string,sk:string):Promise<T|undefined>{return structuredClone(this.rows.get(this.key(pk,sk))) as T|undefined;}
 override async put(item:AwsItem,condition?:string,values?:Record<string,unknown>){
  if(this.failWrite)throw Error('Storage unavailable');const previous=this.rows.get(this.key(item.pk,item.sk));
  if(condition==='attribute_not_exists(pk) OR version < :version'&&previous&&Number(previous.version)>=Number(values?.[':version'])){const error=new Error('Older projection');error.name='ConditionalCheckFailedException';throw error;}
  this.rows.set(this.key(item.pk,item.sk),structuredClone(item));
 }
 override async transact(actions:AwsWrite[]){
  if(this.failWrite)throw Error('Storage unavailable');assert.equal(actions.length,2);
  for(const action of actions){assert.ok(action.Put);assert.equal(action.Put.ConditionExpression,'attribute_not_exists(pk)');const item=action.Put.Item as AwsItem;if(this.rows.has(this.key(item.pk,item.sk))){const error=new Error('Duplicate');error.name='TransactionCanceledException';throw error;}}
  for(const action of actions){const item=action.Put!.Item as AwsItem;this.rows.set(this.key(item.pk,item.sk),structuredClone(item));}
 }
 events(){return [...this.rows.values()].filter(row=>row.pk.startsWith('AUDIT#'));}
}
const timestamp=Date.parse('2026-11-08T12:00:00.000Z');
const s=(value:string):AttributeValue=>({S:value});
const b=(value:boolean):AttributeValue=>({BOOL:value});
const n=(value:number):AttributeValue=>({N:String(value)});
function stream(id:string,name:'INSERT'|'MODIFY',image:Record<string,AttributeValue>,old?:Record<string,AttributeValue>):DynamoDBRecord{return {eventID:id,eventName:name,dynamodb:{ApproximateCreationDateTime:timestamp/1000,NewImage:image,...(old?{OldImage:old}:{})}};}

test('AUDIT AC1 metadata-only records strip arbitrary details and deduplicate across retry days',async()=>{
 const db=new AuditFixture();let now=timestamp;const audit=new AwsAudit(db,()=>now);
 const details={source:'browser',count:2,token:'raw-token',body:'private-conversation',email:'secret@example.com',url:'https://example.com/#grant'} as unknown as AuditDetails;
 await audit.record({id:'request-1',action:'memory.search',actorId:'actor-1',poolId:'pool-1',outcome:'success',details});
 now+=86400000;await audit.record({id:'request-1',action:'memory.search',actorId:'actor-1',poolId:'pool-1',outcome:'success',details});
 assert.equal(db.events().length,1);assert.equal(db.rows.size,2);const row=db.events()[0];assert.equal(row.ttl,timestamp/1000+AUDIT_RETENTION_DAYS*86400);assert.deepEqual(row.details,{count:2,source:'browser'});
 const serialized=JSON.stringify([...db.rows.values()]);for(const secret of ['raw-token','private-conversation','secret@example.com','#grant'])assert.ok(!serialized.includes(secret));
 await assert.rejects(audit.record({id:'request-1',action:'share.open'}),/identifier conflict/);
 await assert.rejects(audit.record({action:'share.open',actorId:'email@example.com'}),/identifier/);
});
test('AUDIT AC2 newest-first pagination bounds queries and validates day-bound cursors',async()=>{
 const db=new AuditFixture();let now=timestamp;const audit=new AwsAudit(db,()=>now);
 for(let i=0;i<3;i++){now=timestamp+i*1000;await audit.record({id:'event-'+i,action:'share.open',targetId:'share-'+i,actorId:'link-recipient'});}
 const page=await audit.page({day:'2026-11-08',limit:2});assert.deepEqual(page.events.map(e=>e.targetId),['share-2','share-1']);assert.ok(page.nextCursor);assert.equal(db.queries[0].Limit,2);
 const next=await audit.page({day:'2026-11-08',cursor:page.nextCursor,limit:2});assert.deepEqual(next.events.map(e=>e.targetId),['share-0']);assert.equal(next.nextCursor,undefined);
 for(const day of ['2026-02-30','2026-11-8','not-a-date','2026-11-08#other'])await assert.rejects(audit.page({day}),/day/);
 for(const cursor of ['!', 'a'.repeat(257),Buffer.from('{}').toString('base64url')])await assert.rejects(audit.page({day:'2026-11-08',cursor}),/cursor/);
 await assert.rejects(audit.page({day:'2026-11-09',cursor:page.nextCursor}),/cursor/);
 await assert.rejects(audit.page({day:'2026-11-08',limit:101}),/limit/);
 now+=31*86400000;assert.deepEqual((await audit.page({day:'2026-11-08'})).events,[]);
});
test('AUDIT AC3 stream classification excludes secrets and irrelevant or recursive keys',async()=>{
 const db=new AuditFixture(),audit=new AwsAudit(db,()=>timestamp);
 const records=[
  stream('pool','INSERT',{pk:s('POOL#pool'),sk:s('META'),owner:s('actor')}),
  stream('memory','INSERT',{pk:s('POOL#pool'),sk:s('MEMORY#memory'),contributorId:s('actor'),revision:s('revision'),memory:{M:{text:s('private text')}}}),
  stream('memory-updated','MODIFY',{pk:s('POOL#pool'),sk:s('MEMORY#memory'),contributorId:s('actor'),revision:s('next'),memory:{M:{text:s('private next text')}}},{revision:s('revision')}),
  stream('share','INSERT',{pk:s('SHARE#share'),sk:s('META'),creatorId:s('actor'),poolId:s('pool'),recipients:{L:[s('private@example.com')]},objectKey:s('private/key')}),
  stream('revoke','MODIFY',{pk:s('SHARE#share'),sk:s('META'),poolId:s('pool'),revoked:b(true)},{revoked:b(false)}),
  stream('delivery','INSERT',{pk:s('DELIVERY#share'),sk:s('emailhash'),state:s('pending'),actor:s('actor'),share:s('share'),email:s('private@example.com'),message:{M:{url:s('private-grant')}}}),
  stream('sent','MODIFY',{pk:s('DELIVERY#share'),sk:s('emailhash'),state:s('sent'),actor:s('actor'),share:s('share')},{state:s('sending')}),
  stream('session','INSERT',{pk:s('SESSION#session-secret'),sk:s('META'),actor:s('actor'),identity:{M:{email:s('private@example.com')}}}),
  stream('index','MODIFY',{pk:s('BATCH#batch'),sk:s('META'),kind:s('index-batch'),state:s('committed'),indexState:s('ready'),actor:s('actor'),poolId:s('pool')},{state:s('committed'),indexState:s('pending')})
 ];
 for(const record of records)await audit.recordStream(record);
 assert.deepEqual(db.events().map(e=>e.action),['pool.created','memory.created','memory.updated','share.created','share.revoked','email.queued','email.sent','session.signin','index.completed']);assert.equal(db.events()[1].outcome,'queued');
 for(const record of records)await audit.recordStream(record);assert.equal(db.events().length,records.length);
 for(const pk of ['AUDIT#2026-11-08','AUDIT-ID#hash','ADMIN#USERS','TOKEN#secret','LOGIN#secret','DELIVERY-QUEUE','unknown'])await audit.recordStream(stream('ignored-'+pk,'INSERT',{pk:s(pk),sk:s('META'),token:s('secret')}));
 await audit.recordStream({...records[0],eventName:'REMOVE'});assert.equal(db.events().length,records.length);
 const serialized=JSON.stringify([...db.rows.values()]);for(const secret of ['private text','private next text','private@example.com','private/key','private-grant','session-secret'])assert.ok(!serialized.includes(secret));
});
test('AUDIT AC4 user projection advances monotonically and emits only state activity',async()=>{
 const db=new AuditFixture(),audit=new AwsAudit(db,()=>timestamp);
 const user=(version:number,active:boolean)=>({pk:s('USER#actor'),sk:s('META'),name:s('Drew'),active:b(active),version:n(version),token:s('never-log-token')});
 const created=stream('created','INSERT',user(1,true));await audit.recordStream(created);
 await audit.recordStream(stream('version','MODIFY',user(2,true),user(1,true)));assert.equal(db.events().length,1);
 await audit.recordStream(stream('suspended','MODIFY',user(3,false),user(2,true)));await audit.recordStream(created);
 assert.deepEqual(await db.get('ADMIN#USERS','USER#actor'),{pk:'ADMIN#USERS',sk:'USER#actor',id:'actor',name:'Drew',active:false,version:3});
 await audit.recordStream(stream('reactivated','MODIFY',user(4,true),user(3,false)));assert.deepEqual(db.events().map(e=>e.action),['user.created','user.suspended','user.reactivated']);assert.ok(!JSON.stringify([...db.rows.values()]).includes('never-log-token'));
});
test('AUDIT AC5 storage and malformed recognized-event failures propagate for stream retry',async()=>{
 const db=new AuditFixture(),audit=new AwsAudit(db,()=>timestamp),event=stream('pool-event','INSERT',{pk:s('POOL#pool'),sk:s('META')});db.failWrite=true;
 await assert.rejects(audit.recordStream(event),/Storage unavailable/);db.failWrite=false;await audit.recordStream(event);assert.equal(db.events().length,1);
 await assert.rejects(audit.recordStream({...event,eventID:undefined}),/Missing stream audit/);
 await assert.rejects(audit.recordStream({...event,eventID:'missing-time',dynamodb:{NewImage:event.dynamodb!.NewImage}}),/Missing stream audit/);
 await audit.recordStream({...event,eventID:'expired',dynamodb:{...event.dynamodb,ApproximateCreationDateTime:(timestamp-31*86400000)/1000}});assert.equal(db.events().length,1);
});
