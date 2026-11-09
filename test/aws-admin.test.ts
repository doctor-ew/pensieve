import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {APIGatewayProxyEventV2,Context} from 'aws-lambda';
import {createAwsAdmin,type AwsAdminOptions} from '../src/aws-admin.js';
import {lambdaAdapter} from '../src/aws-handler.js';
import type {HostedSession} from '../src/hosted-sessions.js';
import type {AwsItem} from '../src/aws-db.js';
const issuer='https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Fixture';
const publicUrl='https://pensieve.example.com';
const ownerToken='a'.repeat(64),otherToken='b'.repeat(64);
function fixture(){
 const items=new Map<string,AwsItem>(),sessions=new Map<string,HostedSession>(),active=new Map<string,boolean>([['owner',true],['other',true]]),revokedUsers:string[]=[],revokedSessions:string[]=[],revokedShares:string[]=[],auditEvents:Parameters<AwsAdminOptions['audit']['record']>[0][]=[],pages:Parameters<AwsAdminOptions['audit']['page']>[0][]=[],queries:unknown[]=[];
 let failAudit=false;
 sessions.set(ownerToken,{userId:'owner',identity:{issuer,subject:'owner-subject',email:'drew@doctorew.com'}});
 const db={get:async(pk:string,sk:string)=>items.get(pk+'/'+sk),put:async(item:AwsItem,condition?:string)=>{const key=item.pk+'/'+item.sk;if(condition&&items.has(key)){const error=new Error('Exists');error.name='ConditionalCheckFailedException';throw error;}items.set(key,item);},query:async(pk:string,options:unknown)=>{queries.push({pk,options});return{items:[{pk,sk:'USER#other',id:'other',name:'Test user',active:true,token:'never expose',privateMemory:'never expose'}],cursor:'USER#other'};}} as unknown as AwsAdminOptions['db'];
 const options:AwsAdminOptions={db,sessions:{get:async token=>sessions.get(token),revokeUser:async id=>{revokedSessions.push(id);}},store:{getUser:async id=>{if(!active.get(id))throw Error('Inactive');return{id,name:id};},revokeUser:async id=>{revokedUsers.push(id);active.set(id,false);}},shares:{revoke:async id=>{revokedShares.push(id);}},audit:{record:async event=>{if(failAudit)throw Error('Audit unavailable');auditEvents.push(event);},page:async input=>{pages.push(input);return{events:[{id:'event-1',action:'memory.created'}],nextCursor:'next'};}},issuer,publicUrl,assets:async name=>name==='admin.html'?'<h1>Administration</h1>':'console.log("admin")'};
 const admin=createAwsAdmin(options),server=createServer((req,res)=>{void admin.handle(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});}),invoke=lambdaAdapter(server);
 async function request(path:string,config:{token?:string;method?:string;headers?:Record<string,string>;origin?:string|null}={}){
  const url=new URL(path,publicUrl),method=config.method??'GET',headers:Record<string,string>={host:url.host,...(config.token?{cookie:'pensieve_session='+config.token}:{}),...(config.origin===null?{}:{origin:config.origin??publicUrl}),...config.headers};
  const event:APIGatewayProxyEventV2={version:'2.0',routeKey:'$default',rawPath:url.pathname,rawQueryString:url.search.slice(1),headers,requestContext:{accountId:'test',apiId:'test',domainName:url.host,domainPrefix:'test',http:{method,path:url.pathname,protocol:'HTTP/1.1',sourceIp:'192.0.2.1',userAgent:'test'},requestId:'test',routeKey:'$default',stage:'$default',time:'',timeEpoch:0},isBase64Encoded:false};return invoke(event,{} as Context);
 }
 return{request,items,sessions,active,revokedUsers,revokedSessions,revokedShares,auditEvents,pages,queries,failAudit:()=>{failAudit=true;}};
}
test('Admin AC1 anonymous HTML redirects to Cognito and API requires a verified session',async()=>{
 const f=fixture(),html=await f.request('/admin',{origin:null});assert.equal(html.statusCode,302);assert.equal(html.headers?.location,'/auth/login?returnTo=%2Fadmin');assert.equal((await f.request('/api/admin/me')).statusCode,401);
 assert.equal((await f.request('/api/admin/me',{headers:{authorization:'Bearer operator-secret','x-user-email':'drew@doctorew.com','cf-access-authenticated-user-email':'drew@doctorew.com'}})).statusCode,401);assert.equal(f.items.size,0);
});
test('Admin AC1/2 personal sessions, spoofed email, wrong issuer and empty subject cannot bootstrap',async()=>{
 const f=fixture();for(const identity of [undefined,{issuer,subject:'other',email:'other@example.com'},{issuer:'https://wrong.example',subject:'owner',email:'drew@doctorew.com'},{issuer,subject:' ',email:'drew@doctorew.com'}]){
  f.sessions.set(otherToken,{userId:'other',...(identity?{identity}:{})});assert.equal((await f.request('/api/admin/me',{token:otherToken,headers:{'x-user-email':'drew@doctorew.com'}})).statusCode,403);
 }assert.equal(f.items.size,0);
 f.sessions.set(ownerToken,{userId:'owner',identity:{issuer,subject:'owner-subject',email:' Drew@DoctorEw.com '}});assert.equal((await f.request('/api/admin/me',{token:ownerToken})).statusCode,200);assert.equal(f.items.get('SYSTEM/PLATFORM_ADMIN')?.subject,'owner-subject');
});
test('Admin AC1/2 owner subject pin is race safe and never follows reassigned email',async()=>{
 const f=fixture();f.sessions.set(otherToken,{userId:'other',identity:{issuer,subject:'different-subject',email:'drew@doctorew.com'}});
 const responses=await Promise.all([f.request('/api/admin/me',{token:ownerToken}),f.request('/api/admin/me',{token:otherToken})]);assert.deepEqual(responses.map(r=>r.statusCode).sort(),[200,403]);
 const pin=f.items.get('SYSTEM/PLATFORM_ADMIN')!,loser=pin.subject==='owner-subject'?otherToken:ownerToken;assert.equal((await f.request('/api/admin/me',{token:loser})).statusCode,403);assert.equal(f.items.get('SYSTEM/PLATFORM_ADMIN'),pin);
});
test('Admin AC2/8 rejects CSRF, foreign host and self suspension before mutation',async()=>{
 const f=fixture();for(const origin of [null,'https://evil.example'])assert.equal((await f.request('/api/admin/users/other/revoke',{token:ownerToken,method:'POST',origin})).statusCode,403);
 assert.equal((await f.request('/api/admin/me',{token:ownerToken,headers:{host:'evil.example'}})).statusCode,403);assert.equal(f.items.size,0);
 assert.equal((await f.request('/api/admin/users/owner/revoke',{token:ownerToken,method:'POST'})).statusCode,403);assert.deepEqual(f.revokedUsers,[]);
 assert.equal((await f.request('/api/admin/users/other/revoke',{token:ownerToken,method:'POST'})).statusCode,200);assert.deepEqual(f.revokedUsers,['other']);assert.deepEqual(f.revokedSessions,['other']);
 assert.equal((await f.request('/api/admin/shares/abc123/revoke',{token:ownerToken,method:'POST'})).statusCode,200);assert.deepEqual(f.revokedShares,['abc123']);
 assert.ok(f.auditEvents.some(e=>e.action==='admin.user.suspend'&&e.outcome==='attempt'));assert.ok(f.auditEvents.some(e=>e.action==='admin.user.suspend'&&e.outcome==='success'));
});
test('Admin AC3/4 activity and account pages are bounded and exclude private account fields',async()=>{
 const f=fixture();assert.equal((await f.request('/api/admin/activity?day=2026-02-30',{token:ownerToken})).statusCode,400);assert.equal((await f.request('/api/admin/activity?day=2026-11-08&limit=101',{token:ownerToken})).statusCode,400);
 const activity=await f.request('/api/admin/activity?day=2026-11-08&limit=25&cursor=cursor-1',{token:ownerToken});assert.equal(activity.statusCode,200);assert.deepEqual(f.pages,[{day:'2026-11-08',limit:25,cursor:'cursor-1'}]);
 const users=await f.request('/api/admin/users?limit=10&cursor=USER%23old',{token:ownerToken});assert.equal(users.statusCode,200);assert.deepEqual(JSON.parse(String(users.body)),{users:[{id:'other',name:'Test user',active:true}],nextCursor:'USER#other'});assert.deepEqual(f.queries,[{pk:'ADMIN#USERS',options:{prefix:'USER#',after:'USER#old',limit:10}}]);
 assert.equal((await f.request('/api/admin/users?limit=0',{token:ownerToken})).statusCode,400);assert.equal((await f.request('/api/admin/users?cursor=wrong',{token:ownerToken})).statusCode,400);
});
test('Admin AC4/8 audit failure blocks reads and actions rather than creating unaudited access',async()=>{
 const f=fixture();f.failAudit();assert.equal((await f.request('/api/admin/users/other/revoke',{token:ownerToken,method:'POST'})).statusCode,503);assert.deepEqual(f.revokedUsers,[]);
 assert.equal((await f.request('/api/admin/activity?day=2026-11-08',{token:ownerToken})).statusCode,503);assert.deepEqual(f.pages,[]);
});
test('Admin AC2 owner portal works without pool membership and duplicate cookies are rejected',async()=>{
 const f=fixture();assert.equal((await f.request('/admin',{token:ownerToken})).statusCode,200);assert.equal((await f.request('/admin.js',{token:ownerToken})).statusCode,200);
 assert.equal((await f.request('/api/admin/me',{headers:{cookie:'pensieve_session='+ownerToken+'; pensieve_session='+otherToken}})).statusCode,401);
 f.active.set('owner',false);assert.equal((await f.request('/api/admin/me',{token:ownerToken})).statusCode,403);
});
