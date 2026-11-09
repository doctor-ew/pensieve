import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {emailAddress} from './executive.js';
export interface InvitationMessage {email:string;title:string;url:string;expiresAt:number;verified:boolean}
export interface SecureMailer {sendCode(email:string,code:string):Promise<void>;sendInvitation(message:InvitationMessage):Promise<void>}
export interface DeliveryStatus {email:string;status:string}
export class DeliveryLedger{
 constructor(private db:DatabaseSync,private now=()=>Date.now()){
 db.exec(`CREATE TABLE IF NOT EXISTS delivery_attempts(id TEXT PRIMARY KEY,actor TEXT NOT NULL,share TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS delivery_quota(scope TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS delivery_quota_time ON delivery_quota(created);
 CREATE INDEX IF NOT EXISTS delivery_quota_scope ON delivery_quota(scope,created);
 CREATE UNIQUE INDEX IF NOT EXISTS delivery_share_email ON delivery_attempts(share,email);`);
 }
 private quota(actor:string,email:string){
 const now=this.now();this.db.prepare('DELETE FROM delivery_quota WHERE created<?').run(now-3600000);
 for(const [scope,max] of [['global',100],['actor:'+actor,25],['email:'+email,5]] as const){
 const n=Number(this.db.prepare('SELECT COUNT(*) n FROM delivery_quota WHERE scope=? AND created>?').get(scope,now-3600000)!.n);
 if(n>=max)throw Error('Email quota reached; try later');
 this.db.prepare('INSERT INTO delivery_quota VALUES (?,?)').run(scope,now);
 }}
 reserveCode(email:string){
 this.db.exec('BEGIN IMMEDIATE');try{this.quota('verification',emailAddress(email));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async send(actor:string,share:string,messages:InvitationMessage[],mailer:SecureMailer){
 const pending:InvitationMessage[]=[];
 this.db.exec('BEGIN IMMEDIATE');
 try{
 for(const m of messages){
 const id=createHash('sha256').update(share+'\0'+m.email).digest('hex');
 if(this.db.prepare('SELECT id FROM delivery_attempts WHERE id=?').get(id))continue;
 this.quota(actor,m.email);
 this.db.prepare('INSERT INTO delivery_attempts VALUES (?,?,?,?,?,?)').run(id,actor,share,m.email,'sending',this.now());pending.push(m);
 }this.db.exec('COMMIT');
 }catch(e){this.db.exec('ROLLBACK');throw e;}
 for(const m of pending){
 let status='sent';try{await mailer.sendInvitation(m);}catch{status='unknown';}
 this.db.prepare('UPDATE delivery_attempts SET status=? WHERE share=? AND email=?').run(status,share,m.email);
 }
 return this.status(share);
 }
 statuses(shares:string[]):Map<string,DeliveryStatus[]>{
 const result=new Map<string,DeliveryStatus[]>();const unique=[...new Set(shares)];
 for(let offset=0;offset<unique.length;offset+=500){
 const batch=unique.slice(offset,offset+500);
 const rows=this.db.prepare("SELECT share,email,CASE WHEN status='sending' AND created<? THEN 'unknown' ELSE status END status FROM delivery_attempts WHERE share IN ("+batch.map(()=>'?').join(',')+")").all(this.now()-120000,...batch) as unknown as {share:string;email:string;status:string}[];
 for(const row of rows){const list=result.get(row.share)??[];list.push({email:row.email,status:row.status});result.set(row.share,list);}
 }
 return result;
 }
 status(share:string){return this.statuses([share]).get(share)??[];}
}
