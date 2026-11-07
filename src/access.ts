import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';
import type {IncomingMessage} from 'node:http';
export type AccessVerifier=(token:string)=>Promise<void>;
export function accessVerifier(issuer:string,audience:string,key?:JWTVerifyGetKey):AccessVerifier{
 const url=new URL(issuer);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.cloudflareaccess.com')||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/'||!audience.trim())throw Error('Invalid Cloudflare Access issuer or audience');
 const canonical=url.origin;
 const keys=key??createRemoteJWKSet(new URL(canonical+'/cdn-cgi/access/certs'),{timeoutDuration:5000});
 return async token=>{
  const {payload}=await jwtVerify(token,keys,{issuer:canonical,audience,algorithms:['RS256'],requiredClaims:['exp','sub'],clockTolerance:5});
  if(payload.type!=='app'||typeof payload.sub!=='string'||(!payload.sub&&!(typeof payload.common_name==='string'&&payload.common_name.trim())))throw Error('Missing Access application identity');
 };
}
export function accessFromEnv():AccessVerifier|undefined{
 const issuer=process.env.PENSIEVE_ACCESS_ISSUER,aud=process.env.PENSIEVE_ACCESS_AUDIENCE;
 if(!issuer&&!aud)return;
 if(!issuer||!aud)throw Error('Both Access issuer and audience required');
 return accessVerifier(issuer,aud);
}
export function publicAccessPath(req:IncomingMessage,path:string):boolean{
 return (req.method==='GET'&&(path==='/health'||['/reader.js','/style.css','/reader-security.js'].includes(path)||/^\/s\/[a-f0-9]{32}$/.test(path)))||/^\/api\/reader\/[a-f0-9]{32}(?:\/(?:code|verify|ask|download))?$/.test(path);
}
