import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {conditionalFailure,type AwsDatabase} from './aws-db.js';
import type {AuditInput} from './aws-audit.js';
import type {HostedSessions} from './hosted-sessions.js';
import type {TeamRepository,ShareRepository} from './repositories.js';

const ownerEmail='drew@doctorew.com';
export interface AdminAudit {
 record(event:AuditInput):Promise<unknown>;
 page(input:{day:string;cursor?:string;limit?:number}):Promise<{events:unknown[];nextCursor?:string}>;
}
export interface AwsAdminOptions {
 db:Pick<AwsDatabase,'get'|'put'|'query'>;
 sessions:Pick<HostedSessions,'get'|'revokeUser'>;
 store:Pick<TeamRepository,'getUser'|'revokeUser'>;
 shares:Pick<ShareRepository,'revoke'>;
 audit:AdminAudit;
 issuer:string;
 publicUrl:string;
 assets?:(name:'admin.html'|'admin.js')=>Promise<string|Buffer>;
}
class AdminError extends Error {constructor(readonly status:number,message:string){super(message);}}
function day(value:string|null):string {
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new AdminError(400,'Use a calendar day in YYYY-MM-DD format');
 const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new AdminError(400,'Invalid calendar day');return value;
}
/** Owner administration trusts verified durable identity, never request email or bearer headers. */
export function createAwsAdmin(options:AwsAdminOptions){
 const publicUrl=new URL(options.publicUrl);
 if(publicUrl.username||publicUrl.password||publicUrl.pathname!=='/'||publicUrl.search||publicUrl.hash||!(publicUrl.protocol==='https:'||(publicUrl.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(publicUrl.hostname))))throw Error('Admin public URL must be an HTTPS origin or local test origin');
 if(!options.issuer.startsWith('https://')||options.issuer.length>512)throw Error('Configured Cognito issuer required');
 const assets=options.assets??(name=>readFile(new URL('../web/'+name,import.meta.url)));
 async function authorize(req:IncomingMessage):Promise<{actorId:string;email:string}>{
  // Deliberately ignore Authorization, forwarded identity and email headers.
  const cookies=(req.headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('pensieve_session='));
  if(cookies.length!==1||!/^pensieve_session=[a-f0-9]{64}$/.test(cookies[0]))throw new AdminError(401,'Sign in with Cognito to administer Pensieve');
  const session=await options.sessions.get(cookies[0].slice('pensieve_session='.length));
  if(!session)throw new AdminError(401,'Sign in with Cognito to administer Pensieve');
  const identity=session.identity;
  if(!identity||identity.issuer!==options.issuer||typeof identity.subject!=='string'||!identity.subject.trim()||identity.subject.length>512||typeof identity.email!=='string'||identity.email.trim().toLowerCase()!==ownerEmail)throw new AdminError(403,'Platform administrator required');
  try{await options.store.getUser(session.userId);}catch{throw new AdminError(403,'Platform administrator required');}
  let pin=await options.db.get('SYSTEM','PLATFORM_ADMIN');
  if(!pin){
   try{await options.db.put({pk:'SYSTEM',sk:'PLATFORM_ADMIN',issuer:identity.issuer,subject:identity.subject,actorId:session.userId},'attribute_not_exists(pk)');}
   catch(error){if(!conditionalFailure(error))throw error;}
   pin=await options.db.get('SYSTEM','PLATFORM_ADMIN');
  }
  if(!pin||pin.issuer!==identity.issuer||pin.subject!==identity.subject)throw new AdminError(403,'Platform administrator identity does not match the pinned owner');
  return {actorId:session.userId,email:ownerEmail};
 }
 return {async handle(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
  let url:URL;try{url=new URL(req.url??'/',publicUrl);}catch{return false;}
  const path=url.pathname;if(path!=='/admin'&&path!=='/admin.js'&&!path.startsWith('/api/admin/'))return false;
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  let actorId:string|undefined;
  try{
   if(url.origin!==publicUrl.origin||req.headers.host!==publicUrl.host||(req.headers.origin&&req.headers.origin!==publicUrl.origin))throw new AdminError(403,'Foreign Host or Origin rejected');
   if(req.method!=='GET'&&req.headers.origin!==publicUrl.origin)throw new AdminError(403,'Same-origin administrator action required');
   const owner=await authorize(req);actorId=owner.actorId;
   if(req.method==='GET'&&(path==='/admin'||path==='/admin.js')){
    await options.audit.record({action:'admin.open',actorId,outcome:'success'});
    const body=await assets(path==='/admin'?'admin.html':'admin.js');res.writeHead(200,{'Content-Type':path==='/admin'?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});res.end(body);return true;
   }
   if(req.method==='GET'&&path==='/api/admin/me'){
    await options.audit.record({action:'admin.identity',actorId,outcome:'success'});json(200,{admin:true,userId:actorId,email:owner.email,role:'platform-admin',contentInspection:false});return true;
   }
   if(req.method==='GET'&&path==='/api/admin/users'){
    const rawLimit=url.searchParams.get('limit'),limit=rawLimit===null?50:Number(rawLimit),cursor=url.searchParams.get('cursor')??undefined;
    if(!Number.isInteger(limit)||limit<1||limit>100||rawLimit===''||(cursor!==undefined&&!/^USER#[A-Za-z0-9_-]{1,128}$/.test(cursor)))throw new AdminError(400,'Invalid account page');
    await options.audit.record({action:'admin.user.list',actorId,outcome:'success'});
    const page=await options.db.query('ADMIN#USERS',{prefix:'USER#',after:cursor,limit});
    json(200,{users:page.items.map(row=>({id:String(row.id??row.sk.slice(5)),name:String(row.name??''),active:row.active===true})),...(page.cursor?{nextCursor:page.cursor}:{})});return true;
   }
   if(req.method==='GET'&&path==='/api/admin/activity'){
    const selectedDay=day(url.searchParams.get('day')),rawLimit=url.searchParams.get('limit'),limit=rawLimit===null?50:Number(rawLimit),cursor=url.searchParams.get('cursor')??undefined;
    if(!Number.isInteger(limit)||limit<1||limit>100||rawLimit===''||(cursor!==undefined&&(!cursor||cursor.length>256)))throw new AdminError(400,'Invalid activity page');
    await options.audit.record({action:'admin.audit.viewed',actorId,outcome:'success'});
    json(200,await options.audit.page({day:selectedDay,limit,cursor}));return true;
   }
   const revoke=/^\/api\/admin\/(users|shares)\/([A-Za-z0-9_-]{1,128})\/revoke$/.exec(path);
   if(req.method==='POST'&&revoke){
    const [,kind,targetId]=revoke;if(kind==='users'&&targetId===actorId)throw new AdminError(403,'The platform administrator cannot suspend their own account');
    const operationId=randomUUID(),action=kind==='users'?'admin.user.suspend':'admin.share.revoke';
    await options.audit.record({id:operationId+':attempt',action,actorId,targetId,outcome:'attempt'});
    try{if(kind==='users'){await options.store.revokeUser(targetId);await options.sessions.revokeUser(targetId);}else await options.shares.revoke(targetId);}
    catch(error){await options.audit.record({id:operationId+':failure',action,actorId,targetId,outcome:'failed'});throw error;}
    await options.audit.record({id:operationId+':success',action,actorId,targetId,outcome:'success'});json(200,{ok:true});return true;
   }
   json(404,{error:'Administrator route unavailable'});return true;
  }catch(error){
   if(error instanceof AdminError){
    if(error.status===401&&req.method==='GET'&&path==='/admin'){res.writeHead(302,{Location:'/auth/login?returnTo=%2Fadmin'});res.end();return true;}
    if(error.status===403)await options.audit.record({action:'admin.denied',...(actorId?{actorId}:{}),outcome:'denied'}).catch(()=>{});
    json(error.status,{error:error.message});return true;
   }
   json(503,{error:'Administration temporarily unavailable'});return true;
  }
 }};
}
