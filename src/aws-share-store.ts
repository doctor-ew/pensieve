import {createHash,randomBytes,randomInt} from 'node:crypto';
import {GetObjectCommand,PutObjectCommand,type S3Client} from '@aws-sdk/client-s3';
import {UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {AwsDatabase,conditionalFailure,type AwsItem,type AwsWrite} from './aws-db.js';
import {validateShare,type Snapshot,type Mailer} from './executive.js';
import type {ShareRepository} from './repositories.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const unavailable=()=>Error('This share is unavailable');
export interface AwsShareMeta extends AwsItem {id:string;objectKey:string;sha256:string;title:string;recipients:string[];expiresAt:number;revoked:boolean;count:number;version:number}
/** Snapshot objects are immutable. A committed DynamoDB pointer alone makes them visible. */
export class AwsShareStore implements ShareRepository {
 constructor(readonly db:AwsDatabase,private readonly s3:S3Client,private readonly bucket:string,readonly now=Date.now){}
 close():void{}
 private summary(meta:AwsShareMeta){return {id:meta.id,title:meta.title,recipients:meta.recipients,expiresAt:meta.expiresAt,revoked:meta.revoked,count:meta.count};}
 async prepareSnapshot(value:unknown):Promise<{snapshot:Snapshot;actions:AwsWrite[]}>{
  const input=validateShare(value),createdAt=this.now();const snapshot:Snapshot={...input,id:randomBytes(16).toString('hex'),createdAt,expiresAt:createdAt+input.days*86400000,revoked:false};
  const meta=await this.upload(snapshot,1);return {snapshot,actions:[this.db.putAction(meta,'attribute_not_exists(pk)'),this.db.putAction({pk:'SHARE-LIST',sk:snapshot.id,...this.summary(meta)},'attribute_not_exists(pk)')]};
 }
 private async upload(snapshot:Snapshot,version:number):Promise<AwsShareMeta>{
  const body=JSON.stringify(snapshot);if(Buffer.byteLength(body)>32*1024*1024)throw Error('Snapshot exceeds 32 MiB; select fewer memories');
  const sha256=hash(body),objectKey=`shares/${snapshot.id}/${sha256}.json`;
  await this.s3.send(new PutObjectCommand({Bucket:this.bucket,Key:objectKey,Body:body,ContentType:'application/json',ServerSideEncryption:'AES256',IfNoneMatch:'*'})).catch(error=>{if(!(error instanceof Error)||error.name!=='PreconditionFailed')throw error;});
  return {pk:'SHARE#'+snapshot.id,sk:'META',id:snapshot.id,objectKey,sha256,title:snapshot.title,recipients:snapshot.recipients,expiresAt:snapshot.expiresAt,revoked:false,count:snapshot.bundle.memories.length,version};
 }
 async importSnapshot(snapshot:Snapshot):Promise<{snapshot:Snapshot;actions:AwsWrite[]}>{
  validateShare(snapshot);if(!/^[a-f0-9]{32}$/.test(snapshot.id)||!Number.isFinite(snapshot.createdAt)||!Number.isFinite(snapshot.expiresAt))throw Error('Invalid legacy snapshot');
  const meta=await this.upload(snapshot,1);meta.revoked=!!snapshot.revoked;
  return {snapshot,actions:[this.db.putAction(meta,'attribute_not_exists(pk)'),this.db.putAction({pk:'SHARE-LIST',sk:snapshot.id,...this.summary(meta)},'attribute_not_exists(pk)')]};
 }
 async create(value:unknown):Promise<Snapshot>{const prepared=await this.prepareSnapshot(value);await this.db.transact(prepared.actions);return prepared.snapshot;}
 async metadata(id:string):Promise<AwsShareMeta>{const meta=await this.db.get<AwsShareMeta>('SHARE#'+id,'META');if(!meta||meta.revoked||meta.expiresAt<=this.now())throw unavailable();return meta;}
 alive(meta:AwsShareMeta):AwsWrite{return this.db.check(meta.pk,'META','version = :version AND revoked = :no AND expiresAt > :now',{':version':meta.version,':no':false,':now':this.now()});}
 async get(id:string):Promise<Snapshot>{
  const meta=await this.metadata(id),response=await this.s3.send(new GetObjectCommand({Bucket:this.bucket,Key:meta.objectKey}));
  if(!response.Body||Number(response.ContentLength)>32*1024*1024)throw unavailable();const body=await response.Body.transformToString();if(Buffer.byteLength(body)>32*1024*1024||hash(body)!==meta.sha256)throw unavailable();
  const snapshot=JSON.parse(body) as Snapshot;if(snapshot.id!==id)throw unavailable();const current=await this.metadata(id);if(current.version!==meta.version)throw Error('Share changed; reload it');return snapshot;
 }
 async list(){return (await this.db.query('SHARE-LIST',{limit:100})).items.map(row=>({id:String(row.id),title:String(row.title),recipients:row.recipients as string[],expiresAt:Number(row.expiresAt),revoked:!!row.revoked,count:Number(row.count)}));}
 async updateContent(id:string,value:unknown):Promise<Snapshot>{
  const meta=await this.metadata(id),previous=await this.get(id),content=value as {title?:unknown;brief?:unknown;bundle?:unknown};
  const input=validateShare({...previous,title:content?.title,brief:content?.brief,bundle:content?.bundle}),snapshot={...previous,title:input.title,brief:input.brief,bundle:input.bundle};const next={...meta,...await this.upload(snapshot,meta.version+1)};
  await this.db.transact([this.db.putAction(next,'version = :version AND revoked = :no',{':version':meta.version,':no':false}),this.db.putAction({...meta,sk:'REVISION#'+meta.version}),this.db.putAction({pk:'SHARE-LIST',sk:id,...this.summary(next)})]);return snapshot;
 }
 async revoke(id:string):Promise<void>{const meta=await this.db.get<AwsShareMeta>('SHARE#'+id,'META');if(!meta)return;await this.db.transact([this.db.putAction({...meta,revoked:true,version:meta.version+1},'version = :v',{':v':meta.version}),this.db.putAction({pk:'SHARE-LIST',sk:id,...this.summary({...meta,revoked:true})})]);}
 async invitation(id:string,email:string):Promise<string>{const meta=await this.metadata(id),snapshot=await this.get(id);if(snapshot.accessMode!=='invitation-link'||!snapshot.recipients.includes(email))throw Error('This share does not allow invitation-link access');const token=randomBytes(32).toString('hex');await this.db.transact([this.alive(meta),this.grant(id,email,token,meta.expiresAt)]);return token;}
 grant(id:string,email:string,token:string,expiresAt:number):AwsWrite{return this.db.putAction({pk:'SHARE#'+id,sk:'GRANT#'+hash(token),email,expiresAt,ttl:Math.ceil(expiresAt/1000)},'attribute_not_exists(pk)');}
 async challenge(id:string,email:string,mailer:Mailer):Promise<void>{
  let meta:AwsShareMeta;try{meta=await this.metadata(id);}catch{return;}if(!meta.recipients.includes(email))return;
  const pk='SHARE#'+id,sk='CHALLENGE#'+hash(email),old=await this.db.get(pk,sk),now=this.now();if(old&&(now-Number(old.sent)<60000||(now-Number(old.window)<3600000&&Number(old.sends)>=5)))return;
  const code=String(randomInt(10000000,100000000)),window=old&&now-Number(old.window)<3600000?Number(old.window):now,digest=hash(`${id}:${email}:${code}`);
  try{await this.db.transact([this.alive(meta),this.db.putAction({pk,sk,email,digest,expiresAt:now+600000,ttl:Math.ceil((now+3600000)/1000),attempts:0,sent:now,window,sends:window===Number(old?.window)?Number(old?.sends)+1:1},old?'sent = :sent':'attribute_not_exists(pk)',old?{':sent':old.sent}:undefined)]);}catch(error){if(conditionalFailure(error))return;throw error;}
  try{await mailer.sendCode(email,code);}catch{await this.db.client.send(new UpdateCommand({TableName:this.db.table,Key:{pk,sk},UpdateExpression:'SET expiresAt = :zero',ConditionExpression:'digest = :digest',ExpressionAttributeValues:{':zero':0,':digest':digest}})).catch(error=>{if(!conditionalFailure(error))throw error;});throw Error('Sign-in email could not be delivered. Please try again later.');}
 }
 async verify(id:string,email:string,code:string):Promise<string>{
  const meta=await this.metadata(id),pk='SHARE#'+id,sk='CHALLENGE#'+hash(email),row=await this.db.get(pk,sk);if(!meta.recipients.includes(email)||!row||Number(row.expiresAt)<=this.now()||Number(row.attempts)>=5)throw Error('Invalid or expired code');
  const valid=row.digest===hash(`${id}:${email}:${code}`),token=randomBytes(32).toString('hex'),expiresAt=Math.min(meta.expiresAt,this.now()+43200000);
  const actions:AwsWrite[]=[this.alive(meta),this.db.putAction({...row,attempts:Number(row.attempts)+1,...(valid?{expiresAt:0}:{})},'digest = :digest AND attempts = :attempts AND expiresAt > :now',{':digest':row.digest,':attempts':row.attempts,':now':this.now()})];if(valid)actions.push(this.grant(id,email,token,expiresAt));
  try{await this.db.transact(actions);}catch(error){if(conditionalFailure(error))throw Error('Invalid or expired code');throw error;}if(!valid)throw Error('Invalid or expired code');return token;
 }
 async authorize(id:string,token:string):Promise<Snapshot>{if(!/^[a-f0-9]{64}$/.test(token))throw Error('Please sign in to view this share');const row=await this.db.get('SHARE#'+id,'GRANT#'+hash(token));if(!row||Number(row.expiresAt)<=this.now())throw Error('Please sign in to view this share');const snapshot=await this.get(id);if(!snapshot.recipients.includes(String(row.email)))throw Error('Please sign in to view this share');return snapshot;}
}
