import {createHash,randomBytes} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from './postgres.js';
import {emailAddress,type Snapshot} from './executive.js';
import type {SecureMailer,InvitationMessage,DeliveryStatus} from './delivery.js';
import type {DeliveryRepository} from './repositories.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Durable at-most-once attempts: queued work resumes; claimed work never silently retries. */
export class PgDeliveryLedger implements DeliveryRepository {
 constructor(readonly pool:Pool,private readonly now=()=>Date.now()){}
 private async quota(client:PoolClient,actor:string,email:string){
  // Serialize admissions across processes so concurrent actors cannot evade global quota.
  await client.query('SELECT pg_advisory_xact_lock(727361917)');const now=this.now();await client.query('DELETE FROM delivery_quota WHERE created<$1',[now-3600000]);
  for(const [scope,max] of [['global',100],['actor:'+actor,25],['email:'+email,5]] as const){const r=await client.query<{n:string}>('SELECT count(*) n FROM delivery_quota WHERE scope=$1 AND created>$2',[scope,now-3600000]);if(Number(r.rows[0].n)>=max)throw Error('Email quota reached; try later');await client.query('INSERT INTO delivery_quota VALUES($1,$2)',[scope,now]);}
 }
 async reserveCode(email:string){await transaction(this.pool,c=>this.quota(c,'verification',emailAddress(email)));}
 private async authorized(client:PoolClient,actor:string,share:string):Promise<Snapshot>{
  const r=await client.query<{body:string;revoked:number}>(`SELECT s.body,s.revoked FROM shares s JOIN team_shares ts ON ts.id=s.id JOIN team_members m ON m.pool=ts.pool AND m.actor=$1 JOIN team_users u ON u.id=m.actor AND u.active=1 WHERE s.id=$2 AND (m.role='owner' OR (m.role='writer' AND ts.creator=$1)) FOR SHARE OF s,ts,m,u`,[actor,share]);
  const row=r.rows[0];if(!row||row.revoked)throw Error('Share unavailable');const snapshot=JSON.parse(row.body) as Snapshot;if(snapshot.expiresAt<=this.now())throw Error('Share unavailable');return snapshot;
 }
 async enqueue(actor:string,share:string,messages:InvitationMessage[]):Promise<void>{
  await transaction(this.pool,async client=>{
   const snapshot=await this.authorized(client,actor,share);
   // One lock per share prevents races between duplicate requests before quota accounting.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['delivery:'+share]);
   for(const message of messages){const email=emailAddress(message.email);if(!snapshot.recipients.includes(email))throw Error('Recipient unavailable');const id=hash(share+'\0'+email);
    if((await client.query('SELECT 1 FROM delivery_attempts WHERE id=$1',[id])).rowCount)continue;
    const url=new URL(message.url);if(url.pathname!=='/s/'+share||url.username||url.password||url.hash||url.search||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw Error('Invalid invitation URL');
    await this.quota(client,actor,email);const fixed:InvitationMessage={email,title:snapshot.title,url:url.href,expiresAt:snapshot.expiresAt,verified:snapshot.accessMode==='email-code'};
    await client.query('INSERT INTO delivery_attempts(id,actor,share,email,status,created,message) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,actor,share,email,'queued',this.now(),JSON.stringify(fixed)]);
   }
  });
 }
 async send(actor:string,share:string,messages:InvitationMessage[],mailer:SecureMailer):Promise<DeliveryStatus[]>{await this.enqueue(actor,share,messages);await this.runBatch(mailer);return this.status(share);}
 async runBatch(mailer:SecureMailer,limit=25):Promise<number>{
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid delivery batch limit');
  await this.pool.query("UPDATE delivery_attempts SET status='unknown' WHERE status='sending' AND COALESCE(claimed,created)<$1",[this.now()-120000]);
  let attempted=0;
  for(let i=0;i<limit;i++){
   const job=await transaction(this.pool,async client=>{
    const row=(await client.query<{id:string;actor:string;share:string;email:string;message:string}>('SELECT id,actor,share,email,message FROM delivery_attempts WHERE status=$1 ORDER BY created,id LIMIT 1 FOR UPDATE SKIP LOCKED',['queued'])).rows[0];if(!row)return;
    let snapshot:Snapshot;try{snapshot=await this.authorized(client,row.actor,row.share);}catch{await client.query("UPDATE delivery_attempts SET status='cancelled' WHERE id=$1",[row.id]);return {cancelled:true as const};}
    if(!snapshot.recipients.includes(row.email)){await client.query("UPDATE delivery_attempts SET status='cancelled' WHERE id=$1",[row.id]);return {cancelled:true as const};}
    const message=JSON.parse(row.message) as InvitationMessage;message.title=snapshot.title;message.expiresAt=snapshot.expiresAt;message.email=row.email;message.verified=snapshot.accessMode==='email-code';
    if(snapshot.accessMode==='invitation-link'){const token=randomBytes(32).toString('hex');await client.query('INSERT INTO access VALUES($1,$2,$3,$4)',[hash(token),row.share,row.email,snapshot.expiresAt]);message.url+='#'+token;}
    await client.query("UPDATE delivery_attempts SET status='sending',claimed=$2 WHERE id=$1",[row.id,this.now()]);return {cancelled:false as const,id:row.id,message};
   });
   if(!job)break;if(job.cancelled)continue;attempted++;let status='sent';try{await mailer.sendInvitation(job.message);}catch{status='unknown';}
   await this.pool.query('UPDATE delivery_attempts SET status=$2 WHERE id=$1',[job.id,status]);
  }return attempted;
 }
 async statuses(shares:string[]):Promise<Map<string,DeliveryStatus[]>>{const result=new Map<string,DeliveryStatus[]>();const unique=[...new Set(shares)];for(let offset=0;offset<unique.length;offset+=500){const rows=(await this.pool.query<{share:string;email:string;status:string}>("SELECT share,email,CASE WHEN status='sending' AND COALESCE(claimed,created)<$1 THEN 'unknown' ELSE status END status FROM delivery_attempts WHERE share=ANY($2::text[])",[this.now()-120000,unique.slice(offset,offset+500)])).rows;for(const r of rows){const list=result.get(r.share)??[];list.push({email:r.email,status:r.status});result.set(r.share,list);}}return result;}
 async status(share:string):Promise<DeliveryStatus[]>{return (await this.statuses([share])).get(share)??[];}
 async checkVerification(action:'code'|'verify',address:string,scope:string):Promise<void>{
  const key=hash(JSON.stringify([action,address,scope]));await transaction(this.pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);const now=this.now();await c.query('DELETE FROM verification_quota WHERE created<$1',[now-60000]);const r=await c.query<{n:string}>('SELECT count(*) n FROM verification_quota WHERE scope=$1 AND created>$2',[key,now-60000]);if(Number(r.rows[0].n)>=(action==='code'?10:30))throw Error('Too many verification requests');await c.query('INSERT INTO verification_quota VALUES($1,$2)',[key,now]);});
 }
}
