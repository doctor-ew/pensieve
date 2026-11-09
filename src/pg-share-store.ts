import {createHash,randomBytes,randomInt} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction,type PgQuery} from './postgres.js';
import {validateShare,type Snapshot,type Mailer} from './executive.js';
import type {ShareRepository} from './repositories.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class PgShareStore implements ShareRepository {
 constructor(readonly pool:Pool,readonly now=()=>Date.now(),private readonly client?:PoolClient){}
 private get q():PgQuery{return this.client??this.pool;}
 private tx<T>(fn:(store:PgShareStore)=>Promise<T>):Promise<T>{return this.client?fn(this):transaction(this.pool,c=>fn(new PgShareStore(this.pool,this.now,c)));}
 async close():Promise<void>{/* Composition root owns pool. */}
 async create(value:unknown):Promise<Snapshot>{const input=validateShare(value),createdAt=this.now();const snapshot:Snapshot={...input,id:randomBytes(16).toString('hex'),createdAt,expiresAt:createdAt+input.days*86400000,revoked:false};await this.q.query('INSERT INTO shares(id,body) VALUES($1,$2)',[snapshot.id,JSON.stringify(snapshot)]);return snapshot;}
 async get(id:string):Promise<Snapshot>{const row=(await this.q.query<{body:string;revoked:number}>('SELECT body,revoked FROM shares WHERE id=$1'+(this.client?' FOR SHARE':''),[id])).rows[0];if(!row)throw Error('This share is unavailable');const snapshot=JSON.parse(row.body) as Snapshot;if(row.revoked||snapshot.expiresAt<=this.now())throw Error('This share is unavailable');return snapshot;}
 async list(){return (await this.q.query<{body:string;revoked:number}>('SELECT body,revoked FROM shares ORDER BY id DESC')).rows.map(row=>{const s=JSON.parse(row.body) as Snapshot;return {id:s.id,title:s.title,recipients:s.recipients,expiresAt:s.expiresAt,revoked:!!row.revoked,count:s.bundle.memories.length};});}
 async updateContent(id:string,value:unknown):Promise<Snapshot>{return this.tx(async s=>{const previous=await s.get(id);const content=value as {title?:unknown;brief?:unknown;bundle?:unknown};const input=validateShare({...previous,title:content?.title,brief:content?.brief,bundle:content?.bundle});const snapshot={...previous,title:input.title,brief:input.brief,bundle:input.bundle};await s.q.query('INSERT INTO revisions VALUES($1,$2,$3)',[id,s.now(),JSON.stringify(previous)]);await s.q.query('UPDATE shares SET body=$1 WHERE id=$2',[JSON.stringify(snapshot),id]);return snapshot;});}
 async revoke(id:string){await this.q.query('UPDATE shares SET revoked=1 WHERE id=$1',[id]);}
 async invitation(id:string,email:string):Promise<string>{return this.tx(async s=>{const snapshot=await s.get(id);if(snapshot.accessMode!=='invitation-link'||!snapshot.recipients.includes(email))throw Error('This share does not allow invitation-link access');const token=randomBytes(32).toString('hex');await s.q.query('INSERT INTO access VALUES($1,$2,$3,$4)',[hash(token),id,email,snapshot.expiresAt]);return token;});}
 async challenge(id:string,email:string,mailer:Mailer):Promise<void>{
  const challenge=await this.tx(async s=>{await s.q.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['challenge',id,email])]);let snapshot:Snapshot;try{snapshot=await s.get(id);}catch{return;}
   if(!snapshot.recipients.includes(email))return;const now=s.now();const old=(await s.q.query<{sent:string;window:string;sends:number}>('SELECT sent,"window",sends FROM challenges WHERE share=$1 AND email=$2',[id,email])).rows[0];
   if(old&&(now-Number(old.sent)<60000||(now-Number(old.window)<3600000&&old.sends>=5)))return;
   const code=String(randomInt(10000000,100000000)),window=old&&now-Number(old.window)<3600000?Number(old.window):now,digest=hash(`${id}:${email}:${code}`);
   await s.q.query('INSERT INTO challenges VALUES($1,$2,$3,$4,0,$5,$6,$7) ON CONFLICT(share,email) DO UPDATE SET digest=excluded.digest,expires=excluded.expires,attempts=0,sent=excluded.sent,"window"=excluded."window",sends=excluded.sends',[id,email,digest,now+600000,now,window,window===Number(old?.window)?old.sends+1:1]);return {code,digest};
  });
  if(!challenge)return;
  try{await mailer.sendCode(email,challenge.code);}catch{await this.q.query('UPDATE challenges SET expires=0 WHERE share=$1 AND email=$2 AND digest=$3',[id,email,challenge.digest]);throw Error('Sign-in email could not be delivered. Please try again later.');}
 }
 async verify(id:string,email:string,code:string):Promise<string>{
  const result=await this.tx(async s=>{const snapshot=await s.get(id);const row=(await s.q.query<{digest:string;expires:string;attempts:number}>('SELECT digest,expires,attempts FROM challenges WHERE share=$1 AND email=$2 FOR UPDATE',[id,email])).rows[0];
   if(!snapshot.recipients.includes(email)||!row||Number(row.expires)<=s.now()||row.attempts>=5)return null;
   await s.q.query('UPDATE challenges SET attempts=attempts+1 WHERE share=$1 AND email=$2',[id,email]);
   if(row.digest!==hash(`${id}:${email}:${code}`))return null;
   await s.q.query('UPDATE challenges SET expires=0 WHERE share=$1 AND email=$2',[id,email]);const token=randomBytes(32).toString('hex');await s.q.query('INSERT INTO access VALUES($1,$2,$3,$4)',[hash(token),id,email,Math.min(snapshot.expiresAt,s.now()+43200000)]);return token;
  });if(!result)throw Error('Invalid or expired code');return result;
 }
 async authorize(id:string,token:string):Promise<Snapshot>{const row=(await this.q.query<{email:string;expires:string}>('SELECT email,expires FROM access WHERE digest=$1 AND share=$2',[hash(token),id])).rows[0];if(!row||Number(row.expires)<=this.now())throw Error('Please sign in to view this share');const snapshot=await this.get(id);if(!snapshot.recipients.includes(row.email))throw Error('Please sign in to view this share');return snapshot;}
}
