import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
export interface VerificationGuard {check(action:'code'|'verify',address:string,recipientScope?:string):void;verifyHuman(token:unknown):Promise<void>;siteKey?:string}
export function verificationGuard(db:DatabaseSync,options:{siteKey?:string;secret?:string;hostname?:string;fetcher?:typeof fetch;now?:()=>number}={}):VerificationGuard{
 const {siteKey,secret,hostname}=options;
 if((siteKey||secret)&&(!siteKey||!secret||!hostname))throw Error('Complete Turnstile configuration required');
 db.exec('CREATE TABLE IF NOT EXISTS verification_limits(bucket TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS verification_limit_window ON verification_limits(window)');
 const now=options.now??Date.now;
 return {siteKey,check(action,address,recipientScope=''){
 const key=createHash('sha256').update(JSON.stringify([action,address,recipientScope])).digest('hex'),time=now(),window=Math.floor(time/60000);
 db.prepare('DELETE FROM verification_limits WHERE window<?').run(window-1);
 db.prepare('INSERT INTO verification_limits VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window').run(key,window);
 if(Number(db.prepare('SELECT count FROM verification_limits WHERE bucket=?').get(key)!.count)>(action==='code'?10:30))throw Error('Too many verification requests; try later');
 },async verifyHuman(token){
 if(!secret)return;
 if(typeof token!=='string'||!token||token.length>2048)throw Error('Complete the verification challenge');
 const response=await (options.fetcher??fetch)('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret,response:token}),signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('Verification unavailable');
 const result=await response.json() as {success?:boolean;hostname?:string;action?:string};
 if(!result.success||result.hostname!==hostname||result.action!=='pensieve-email')throw Error('Verification failed');
 }};
}
