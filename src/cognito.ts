import {createHash,randomBytes} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';

export interface CognitoIdentity { issuer:string; subject:string; email:string }
export interface LoginState {
  digest:string; browser:string; verifier:string; nonce:string; returnTo:string; expires:number;
}
export interface LoginStates {
  put(state:LoginState):Promise<void>;
  take(digest:string,browser:string,now:number):Promise<LoginState|undefined>;
}
export interface CognitoConfig { issuer:string; clientId:string; domain:string; publicUrl:string }
export interface CognitoDependencies { keys?:JWTVerifyGetKey; fetcher?:typeof fetch; now?:()=>number }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const opaque=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(value);

function origin(value:string,loopback=false):URL {
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||
    !(url.protocol==='https:'||(loopback&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw Error('Expected an HTTPS origin');
  return url;
}
/** Identity verification is independent of HTTP handling and account authorization. */
export class CognitoAuth {
  readonly redirectUri:string;
  private readonly config:CognitoConfig;
  private readonly keys:JWTVerifyGetKey;
  private readonly fetcher:typeof fetch;
  private readonly now:()=>number;
  constructor(config:CognitoConfig,private readonly states:LoginStates,dependencies:CognitoDependencies={}) {
    const issuer=new URL(config.issuer);
    if(!/^https:\/\/cognito-idp\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/\1_[A-Za-z0-9]+$/.test(config.issuer)||issuer.search||issuer.hash||!config.clientId||!/^[A-Za-z0-9]{1,128}$/.test(config.clientId))throw Error('Invalid Cognito issuer or client ID');
    const domain=origin(config.domain),publicUrl=origin(config.publicUrl,true);
    this.config={...config,domain:domain.origin,publicUrl:publicUrl.origin};
    this.redirectUri=publicUrl.origin+'/auth/callback';
    this.keys=dependencies.keys??createRemoteJWKSet(new URL(config.issuer+'/.well-known/jwks.json'),{timeoutDuration:5000});
    this.fetcher=dependencies.fetcher??fetch;this.now=dependencies.now??Date.now;
  }
  async begin(browserBinding:string,returnTo='/'):Promise<string> {
    if(!opaque(browserBinding))throw Error('Invalid browser login binding');
    const target=new URL(returnTo,this.config.publicUrl);
    if(!returnTo.startsWith('/')||returnTo.startsWith('//')||target.origin!==this.config.publicUrl||returnTo.length>2048||target.hash)throw Error('Invalid post-login destination');
    const state=random(),verifier=random(),nonce=random();
    await this.states.put({digest:digest(state),browser:digest(browserBinding),verifier,nonce,returnTo:target.pathname+target.search,expires:this.now()+300_000});
    const url=new URL('/oauth2/authorize',this.config.domain);
    url.search=new URLSearchParams({response_type:'code',client_id:this.config.clientId,redirect_uri:this.redirectUri,scope:'openid email',prompt:'login',state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}).toString();
    return url.href;
  }
  async complete(input:{code:string;state:string;browserBinding:string}):Promise<{identity:CognitoIdentity;returnTo:string}> {
    if(!opaque(input.state)||!opaque(input.browserBinding)||typeof input.code!=='string'||!input.code||input.code.length>4096)throw Error('Invalid login callback');
    const state=await this.states.take(digest(input.state),digest(input.browserBinding),this.now());
    if(!state)throw Error('Invalid or expired login state');
    const response=await this.fetcher(new URL('/oauth2/token',this.config.domain),{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:this.config.clientId,code:input.code,redirect_uri:this.redirectUri,code_verifier:state.verifier})});
    if(!response.ok)throw Error('Identity provider could not complete sign-in');
    const text=await response.text();if(text.length>32768)throw Error('Invalid identity response');
    const data:unknown=JSON.parse(text);
    const token=typeof data==='object'&&data!==null&&'id_token' in data?data.id_token:undefined;
    if(typeof token!=='string'||token.length>16384)throw Error('Missing identity token');
    const {payload}=await jwtVerify(token,this.keys,{issuer:this.config.issuer,audience:this.config.clientId,algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce','email','email_verified','token_use'],clockTolerance:5,currentDate:new Date(this.now())});
    if(payload.aud!==this.config.clientId||payload.token_use!=='id'||payload.email_verified!==true||payload.nonce!==state.nonce||typeof payload.sub!=='string'||!payload.sub.trim()||payload.sub.length>512||typeof payload.email!=='string'||payload.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)||typeof payload.iat!=='number'||payload.iat>Math.floor(this.now()/1000)+5)throw Error('Verified human identity required');
    return {identity:{issuer:this.config.issuer,subject:payload.sub,email:payload.email},returnTo:state.returnTo};
  }
  logoutUrl():string {
    const url=new URL('/logout',this.config.domain);url.search=new URLSearchParams({client_id:this.config.clientId,logout_uri:this.config.publicUrl+'/'}).toString();return url.href;
  }
}
export function cognitoFromEnv(publicUrl:string,states:LoginStates):CognitoAuth|undefined {
  const issuer=process.env.PENSIEVE_COGNITO_ISSUER,clientId=process.env.PENSIEVE_COGNITO_CLIENT_ID,domain=process.env.PENSIEVE_COGNITO_DOMAIN;
  if(!issuer&&!clientId&&!domain)return;
  if(!issuer||!clientId||!domain)throw Error('Cognito issuer, client ID and domain are required together');
  return new CognitoAuth({issuer,clientId,domain,publicUrl},states);
}
