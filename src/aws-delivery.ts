import {createHash} from 'node:crypto';
import {UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {AwsDatabase,conditionalFailure,type AwsItem,type AwsWrite} from './aws-db.js';
import {AwsShareStore,type AwsShareMeta} from './aws-share-store.js';
import {emailAddress,type Snapshot} from './executive.js';
import type {DeliveryRepository,TeamRepository} from './repositories.js';
import type {DeliveryStatus,InvitationMessage,SecureMailer} from './delivery.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
interface Job extends AwsItem {kind:'delivery-job';state:'pending'|'sending'|'sent'|'unknown'|'cancelled';actor:string;share:string;email:string;message:InvitationMessage;created:number;claimed?:number}
/** Durable one-attempt invitations; ambiguous external effects are never silently repeated. */
export class AwsDeliveryLedger implements DeliveryRepository {
 constructor(readonly db:AwsDatabase,private readonly shares:AwsShareStore,private readonly team:TeamRepository,private readonly now=Date.now){}
 private async quotaActions(actor:string,email:string):Promise<AwsWrite[]>{
  const actions:AwsWrite[]=[];for(const [scope,max] of [['global',100],['actor:'+actor,25],['email:'+email,5]] as const){
   const pk='MAIL-QUOTA#'+hash(scope),old=await this.db.get(pk,'META'),times=(old?.times as number[]|undefined??[]).filter(time=>time>this.now()-3600000);if(times.length>=max)throw Error('Email quota reached; try later');
   actions.push(this.db.putAction({pk,sk:'META',times:[...times,this.now()],version:Number(old?.version??0)+1,ttl:Math.ceil((this.now()+3600000)/1000)},old?'version = :version':'attribute_not_exists(pk)',old?{':version':old.version}:undefined));
  }return actions;
 }
 async reserveCode(email:string):Promise<void>{for(let attempt=0;attempt<5;attempt++){try{await this.db.transact(await this.quotaActions('verification',emailAddress(email)));return;}catch(error){if(!conditionalFailure(error)||attempt===4)throw error;}}}
 private async authorization(actor:string,share:string):Promise<{snapshot:Snapshot;meta:AwsShareMeta;actions:AwsWrite[]}>{
  const meta=await this.shares.metadata(share);if(typeof meta.poolId!=='string'||typeof meta.creatorId!=='string')throw Error('Share unavailable');
  await this.team.authorizeShareRevocation(actor,meta.poolId,share);
  const user=await this.db.get('USER#'+actor,'META'),member=await this.db.get('POOL#'+meta.poolId,'MEMBER#'+actor);
  if(!user?.active||!member||(member.role!=='owner'&&!(member.role==='writer'&&meta.creatorId===actor)))throw Error('Share unavailable');
  const snapshot=await this.shares.get(share);
  return {snapshot,meta,actions:[this.shares.alive(meta),this.db.check('USER#'+actor,'META','active = :active AND version = :version',{':active':true,':version':user.version}),this.db.check('POOL#'+meta.poolId,'MEMBER#'+actor,'version = :version AND #role = :role',{':version':member.version,':role':member.role})].map(action=>action.ConditionCheck?.ConditionExpression?.includes('#role')?{ConditionCheck:{...action.ConditionCheck,ExpressionAttributeNames:{'#role':'role'}}}:action)};
 }
 async send(actor:string,share:string,messages:InvitationMessage[],_mailer:SecureMailer):Promise<DeliveryStatus[]>{
  if(messages.length>25)throw Error('Too many invitation recipients');
  for(const requested of messages){const email=emailAddress(requested.email),pk='DELIVERY#'+share,sk=hash(email);if(await this.db.get(pk,sk))continue;
   const url=new URL(requested.url);if(url.pathname!=='/s/'+share||url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Invalid invitation URL');
   for(let attempt=0;attempt<5;attempt++){
    const auth=await this.authorization(actor,share);if(!auth.snapshot.recipients.includes(email))throw Error('Recipient unavailable');
    const message:InvitationMessage={email,title:auth.snapshot.title,url:url.href,expiresAt:auth.snapshot.expiresAt,verified:auth.snapshot.accessMode==='email-code'};
    const job:Job={pk,sk,kind:'delivery-job',state:'pending',actor,share,email,message,created:this.now()};
    try{await this.db.transact([...auth.actions,...await this.quotaActions(actor,email),this.db.putAction(job,'attribute_not_exists(pk)'),this.db.putAction({pk:'DELIVERY-QUEUE',sk:share+'#'+sk,jobPk:pk,jobSk:sk},'attribute_not_exists(pk)')]);break;}
    catch(error){if(await this.db.get(pk,sk))break;if(!conditionalFailure(error)||attempt===4)throw error;}
   }
  }return this.status(share);
 }
 async processDeliveryJob(pk:string,sk:string,mailer:SecureMailer):Promise<boolean>{
  const job=await this.db.get<Job>(pk,sk);if(!job)return false;
  if(job.state==='sending'&&Number(job.claimed)<=this.now()-120000){await this.finish(job,'unknown');return false;}
  if(job.state!=='pending')return false;
  let auth:Awaited<ReturnType<AwsDeliveryLedger['authorization']>>;
  try{auth=await this.authorization(job.actor,job.share);if(!auth.snapshot.recipients.includes(job.email))throw Error('Recipient unavailable');}
  catch(error){if(error instanceof Error&&['Share unavailable','This share is unavailable','Pool unavailable','Unauthorized identity','Writer authorization required','Recipient unavailable'].includes(error.message)){await this.finish(job,'cancelled');return false;}throw error;}
  try{await this.db.transact([...auth.actions,{Update:{TableName:this.db.table,Key:{pk,sk},UpdateExpression:'SET #state = :sending, claimed = :now',ConditionExpression:'#state = :pending',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':sending':'sending',':pending':'pending',':now':this.now()}}}]);}catch(error){if(conditionalFailure(error)&&(await this.db.get<Job>(pk,sk))?.state!=='pending')return false;throw error;}
  const message={...job.message,email:job.email,title:auth.snapshot.title,expiresAt:auth.snapshot.expiresAt,verified:auth.snapshot.accessMode==='email-code'};
  try{if(auth.snapshot.accessMode==='invitation-link')message.url+='#'+await this.shares.invitation(job.share,job.email);await mailer.sendInvitation(message);await this.finish({...job,state:'sending'},'sent');}
  catch{await this.finish({...job,state:'sending'},'unknown');}return true;
 }
 private async finish(job:Job,state:Job['state']):Promise<void>{try{await this.db.transact([{Update:{TableName:this.db.table,Key:{pk:job.pk,sk:job.sk},UpdateExpression:'SET #state = :next',ConditionExpression:'#state = :prior',ExpressionAttributeNames:{'#state':'state'},ExpressionAttributeValues:{':next':state,':prior':job.state}}},{Delete:{TableName:this.db.table,Key:{pk:'DELIVERY-QUEUE',sk:job.share+'#'+job.sk}}}]);}catch(error){if(!conditionalFailure(error))throw error;}}
 async runBatch(mailer:SecureMailer,limit=25):Promise<number>{if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid delivery batch limit');const page=await this.db.query('DELIVERY-QUEUE',{limit});let count=0;for(const row of page.items)if(await this.processDeliveryJob(String(row.jobPk),String(row.jobSk),mailer))count++;return count;}
 async status(share:string):Promise<DeliveryStatus[]>{return (await this.db.query<Job>('DELIVERY#'+share,{limit:25})).items.map(job=>({email:job.email,status:job.state==='sending'&&Number(job.claimed)<=this.now()-120000?'unknown':job.state==='pending'?'queued':job.state}));}
 async statuses(shares:string[]):Promise<Map<string,DeliveryStatus[]>>{
  const unique=[...new Set(shares)];if(unique.length>100)throw Error('Too many share statuses');
  const metas=await this.db.batchGet(unique.map(id=>({pk:'SHARE#'+id,sk:'META'}))),keys=metas.flatMap(meta=>(meta.recipients as string[]).map(email=>({pk:'DELIVERY#'+String(meta.id),sk:hash(email)}))),jobs=await this.db.batchGet<Job>(keys),result=new Map<string,DeliveryStatus[]>();
  for(const share of unique)result.set(share,[]);for(const job of jobs)result.get(job.share)?.push({email:job.email,status:job.state==='sending'&&Number(job.claimed)<=this.now()-120000?'unknown':job.state==='pending'?'queued':job.state});return result;
 }
 async checkVerification(action:'code'|'verify',address:string,scope:string):Promise<void>{const now=this.now(),pk='VERIFY-RATE#'+hash(JSON.stringify([action,address,scope]));try{await this.db.client.send(new UpdateCommand({TableName:this.db.table,Key:{pk,sk:String(Math.floor(now/60000))},UpdateExpression:'SET #ttl = :ttl ADD #n :one',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':ttl':Math.ceil((now+120000)/1000),':one':1,':max':action==='code'?10:30}}));}catch(error){if(conditionalFailure(error))throw Error('Too many verification requests');throw error;}}
}
