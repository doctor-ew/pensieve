import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,chmod,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {hostname} from 'node:os';
import {execFile} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport,StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {TeamClient} from './team-client.js';

interface Tokens {access_token:string;refresh_token:string;expires_in:number;token_type:string}
interface Endpoints {issuer:string;authorization_endpoint:string;token_endpoint:string;registration_endpoint:string;revocation_endpoint:string}
export interface AgentConnection {
  version:1;url:string;name:string;connectionId:string;actor:{id:string;name:string};clientId:string;
  tokens:Tokens;expiresAt:number;endpoints:Endpoints;legacyBindings:string[];
  refreshAttempted?:boolean;signInRequired?:boolean;disconnectPending?:boolean;
}
const filename='agent-connection.json';
const queues=new Map<string,Promise<void>>();
export class SignInRequired extends Error {
  readonly code='SIGN_IN_REQUIRED';
  constructor(message='Sign in to Pensieve using connect_pensieve or pensieve connect. Local work remains available.') {super(message);this.name='SignInRequired';}
}
export async function readAgentConnection(home:string):Promise<AgentConnection|undefined>{
  try{
    const value=JSON.parse(await readFile(join(home,filename),'utf8')) as AgentConnection;
    if(value.version!==1||!value.actor?.id||!value.clientId||!value.connectionId||!value.tokens?.access_token||!value.tokens.refresh_token||!Number.isFinite(value.expiresAt)||!Array.isArray(value.legacyBindings))throw Error('Invalid saved agent connection');
    checkedOrigin(value.url);checkEndpoints(value.url,value.endpoints);return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
}
function checkedOrigin(value:string){const url=new URL(value);if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS server origin or loopback development server');return url.origin;}
function checkEndpoints(origin:string,value:Endpoints){
  if(new URL(value.issuer).href!==origin+'/')throw Error('Authorization issuer mismatch');
  for(const key of ['authorization_endpoint','token_endpoint','registration_endpoint','revocation_endpoint'] as const){const u=new URL(value[key]);if(u.origin!==origin||u.username||u.password||u.hash||u.search)throw Error('Authorization endpoints must belong to the configured Pensieve service');}
}
async function save(home:string,state:AgentConnection){
  const path=join(home,filename),temp=path+'.'+randomUUID();const file=await open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(state)+'\n');await file.sync();}finally{await file.close();}
  await rename(temp,path);await chmod(path,0o600);
}
/** SQLite provides an OS-released process lock; a local promise queue prevents event-loop deadlock. */
async function locked<T>(home:string,fn:()=>Promise<T>):Promise<T>{
  await mkdir(home,{recursive:true,mode:0o700});const canonical=await realpath(home),prior=queues.get(canonical)??Promise.resolve();
  let release!:()=>void;const turn=new Promise<void>(resolve=>{release=resolve;});const tail=prior.then(()=>turn);queues.set(canonical,tail);await prior;
  let db:DatabaseSync|undefined,begun=false;
  try{const path=join(canonical,'agent-lock.sqlite');db=new DatabaseSync(path);await chmod(path,0o600);db.exec('PRAGMA busy_timeout=0');
    const deadline=Date.now()+30000;
    for(;;){try{db.exec('BEGIN IMMEDIATE');begun=true;break;}catch(error){if(!String(error).includes('database is locked')||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,50));}}
    return await fn();}
  finally{if(begun)db!.exec('ROLLBACK');db?.close();release();if(queues.get(canonical)===tail)queues.delete(canonical);}
}
async function jsonRequest(url:string,options:RequestInit={}):Promise<Record<string,unknown>>{
  const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok){const error=new Error(`Authorization request failed (${response.status})`);Object.assign(error,{status:response.status});throw error;}
  const reader=response.body?.getReader();if(!reader)throw Error('Missing authorization response');let bytes=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536)throw Error('Authorization response too large');chunks.push(value);}}finally{await reader.cancel();}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!result||typeof result!=='object'||Array.isArray(result))throw Error('Invalid authorization response');return result;
}
function parseTokens(value:Record<string,unknown>):Tokens{
  if(typeof value.access_token!=='string'||!value.access_token||value.access_token.length>8192||typeof value.refresh_token!=='string'||!value.refresh_token||value.refresh_token.length>8192||typeof value.expires_in!=='number'||value.expires_in<1||value.expires_in>86400||String(value.token_type).toLowerCase()!=='bearer')throw Error('Server must issue a renewable agent connection');
  return value as unknown as Tokens;
}
const form=(fields:Record<string,string>):RequestInit=>({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields)});
interface RpcConnection {client:Client;ready:Promise<void>;active:number;idle?:ReturnType<typeof setTimeout>}
const rpcConnections=new Map<string,RpcConnection>();
async function rpc(url:string,token:string,path:string,body?:unknown):Promise<unknown>{
  const key=createHash('sha256').update(url+'\0'+token).digest('hex');
  let connection=rpcConnections.get(key);
  if(!connection){
    const client=new Client({name:'pensieve-local-agent',version:'1'});
    connection={client,active:0,ready:client.connect(new StreamableHTTPClientTransport(new URL('/mcp',url),{requestInit:{headers:{Authorization:'Bearer '+token},redirect:'error'}}),{timeout:20000})};
    rpcConnections.set(key,connection);
  }
  const current=connection;clearTimeout(current.idle);current.active++;
  try{
    try{await current.ready;}catch(error){rpcConnections.delete(key);await current.client.close();throw error;}
    const result=await current.client.callTool({name:'connection_request',arguments:{path,...(body===undefined?{}:{body})}},undefined,{timeout:30000});
    if(result.isError)throw Error('Pensieve denied the operation; check pool access and capture policy');
    const content=result.content;if(!Array.isArray(content)||content[0]?.type!=='text'||typeof content[0]?.text!=='string')throw Error('Invalid Pensieve operation response');
    return JSON.parse(content[0].text);
  }finally{
    current.active--;
    if(!current.active){current.idle=setTimeout(()=>{if(rpcConnections.get(key)===current)rpcConnections.delete(key);void current.client.close();},30000);current.idle.unref();}
  }
}
async function credential(home:string,expected:AgentConnection,rejected?:string):Promise<AgentConnection>{
  return locked(home,async()=>{
    const state=await readAgentConnection(home);
    if(!state||state.actor.id!==expected.actor.id||state.url!==expected.url)throw new SignInRequired('The connected account changed. Start this operation again for the current account.');
    if(state.refreshAttempted||state.signInRequired||state.disconnectPending)throw new SignInRequired();
    if(rejected&&state.tokens.access_token!==rejected)return state;
    if(!rejected&&state.expiresAt>Date.now()+30000)return state;
    // Commit uncertainty before sending a single-use refresh token. A crash/lost reply requires sign-in, never replay.
    state.refreshAttempted=true;await save(home,state);
    try{
      const tokens=parseTokens(await jsonRequest(state.endpoints.token_endpoint,form({grant_type:'refresh_token',refresh_token:state.tokens.refresh_token,client_id:state.clientId,resource:state.url+'/mcp'})));
      state.tokens=tokens;state.expiresAt=Date.now()+tokens.expires_in*1000;delete state.refreshAttempted;await save(home,state);return state;
    }catch{throw new SignInRequired('Pensieve could not safely renew this connection. Sign in again; local work and queued saves are preserved.');}
  });
}
export class OAuthTeamClient extends TeamClient {
  constructor(private readonly home:string,private readonly connection:AgentConnection){super(connection.url,'oauth-account:'+connection.actor.id,connection.legacyBindings);}
  override async request<T>(path:string,body?:unknown):Promise<T>{
    let state=await credential(this.home,this.connection);
    try{return await rpc(state.url,state.tokens.access_token,path,body) as T;}
    catch(error){
      if(!(error instanceof StreamableHTTPError)||error.code!==401)throw error;
      state=await credential(this.home,this.connection,state.tokens.access_token);
      try{return await rpc(state.url,state.tokens.access_token,path,body) as T;}
      catch(second){if(second instanceof StreamableHTTPError&&second.code===401)throw new SignInRequired();throw second;}
    }
  }
}
export async function connectionStatus(home:string){
  const state=await readAgentConnection(home);
  if(!state)return {status:'not_connected',action:'connect_pensieve'};
  return {status:state.disconnectPending?'disconnect_pending':state.refreshAttempted||state.signInRequired?'sign_in_required':state.expiresAt<=Date.now()+30000?'renewal_due':'connected',server:state.url,name:state.name,account:state.actor.name,connectionId:state.connectionId,expiresAt:new Date(state.expiresAt).toISOString()};
}
export async function disconnectAgent(home:string){
  return locked(home,async()=>{
    const state=await readAgentConnection(home);if(!state)return {disconnected:true};
    state.disconnectPending=true;await save(home,state);
    const response=await fetch(state.endpoints.revocation_endpoint,{...form({client_id:state.clientId,token:state.tokens.refresh_token,token_type_hint:'refresh_token'}),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('Local access stopped; remote disconnect unconfirmed. Retry disconnect.');
    // Keep a signed-out marker so an old legacy key cannot silently regain access.
    state.signInRequired=true;delete state.disconnectPending;state.tokens={access_token:'disconnected',refresh_token:'disconnected',token_type:'Bearer',expires_in:1};await save(home,state);
    return {disconnected:true,server:state.url,name:state.name};
  });
}
export interface BrowserConnection {url:string;done:Promise<{connected:string;user:{id:string;name:string}}>}
export async function beginBrowserConnection(home:string,serverUrl:string,name=`Pensieve on ${hostname()}`,options:{openBrowser?:boolean;timeoutMs?:number}={}):Promise<BrowserConnection>{
  const origin=checkedOrigin(serverUrl);if(!name.trim()||name.length>160)throw Error('Connection name must contain 1–160 characters');
  const before=await readAgentConnection(home);
  let legacy:{actor:string;binding:string}|undefined;
  try{const old=JSON.parse(await readFile(join(home,'team-connection.json'),'utf8'));if(old.url===origin&&typeof old.token==='string'){const client=new TeamClient(origin,old.token);legacy={actor:(await client.me()).id,binding:client.binding};}}catch{/* Unverifiable legacy queues remain held. */}
  const metadata=await jsonRequest(origin+'/.well-known/oauth-authorization-server') as unknown as Endpoints;checkEndpoints(origin,metadata);
  const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
  let complete!:(value:{connected:string;user:{id:string;name:string}})=>void,fail!:(reason:Error)=>void;
  const done=new Promise<{connected:string;user:{id:string;name:string}}>((resolve,reject)=>{complete=resolve;fail=reject;});
  // Callers may display the URL before attaching their completion handler.
  void done.catch(()=>{});
  let consumed=false;let clientId='',redirect='';let timer:ReturnType<typeof setTimeout>|undefined;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url??'/',redirect);
    if(req.method!=='GET'||req.headers.host!==new URL(redirect).host||url.pathname!=='/callback'||url.searchParams.get('state')!==state){res.writeHead(400);res.end('Invalid sign-in callback');return;}
    if(consumed){res.writeHead(409);res.end('Sign-in already handled');return;}consumed=true;
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');
    try{
      const code=url.searchParams.get('code');if(url.searchParams.has('error')||!code||code.length>4096)throw Error('Sign-in was cancelled or rejected');
      const tokens=parseTokens(await jsonRequest(metadata.token_endpoint,form({grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:redirect,client_id:clientId,resource:origin+'/mcp'})));
      const identity=await rpc(origin,tokens.access_token,'me') as {user:{id:string;name:string}};
      if(!identity.user?.id||!identity.user.name)throw Error('Could not verify connected identity');
      await locked(home,async()=>{
        const current=await readAgentConnection(home);
        if(current?.connectionId!==before?.connectionId)throw Error('Another sign-in completed; retry this connection');
        const legacyBindings=[...(legacy?.actor===identity.user.id?[legacy.binding]:[]),...(before?.url===origin&&before.actor.id===identity.user.id?before.legacyBindings:[])];
        await save(home,{version:1,url:origin,name,actor:identity.user,connectionId:randomUUID(),clientId,tokens,endpoints:metadata,expiresAt:Date.now()+tokens.expires_in*1000,legacyBindings:[...new Set(legacyBindings)]});
      });
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('Pensieve connected. Return to your agent; no restart is needed.');complete({connected:origin,user:identity.user});
    }catch{res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end('Could not finish connecting. Return to your agent and try sign-in again.');fail(new SignInRequired('Browser sign-in did not complete. The prior connection was preserved.'));}
    finally{if(timer)clearTimeout(timer);server.close();server.closeIdleConnections();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Loopback callback unavailable');redirect=`http://127.0.0.1:${address.port}/callback`;
  try{
    const registration=await jsonRequest(metadata.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:name,redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'memories'})});
    if(typeof registration.client_id!=='string'||!registration.client_id||registration.client_id.length>512)throw Error('Invalid client registration');clientId=registration.client_id;
    const authorization=new URL(metadata.authorization_endpoint);authorization.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirect,resource:origin+'/mcp',scope:'memories',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state}).toString();
    timer=setTimeout(()=>{server.close();server.closeAllConnections();fail(new SignInRequired('Sign-in timed out. Start connect_pensieve again.'));},options.timeoutMs??300000);
    if(options.openBrowser){const opener=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';execFile(opener,process.platform==='win32'?['url.dll,FileProtocolHandler',authorization.href]:[authorization.href],()=>{});}
    return {url:authorization.href,done};
  }catch(error){server.close();throw error;}
}
