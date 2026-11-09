import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base=process.env.PENSIEVE_PROOF_URL,credential=process.env.PENSIEVE_PROOF_TOKEN;
if(!base||!credential)throw Error('Explicit proof URL and personal credential required');
const redirect='http://127.0.0.1:9811/callback';
const verifier=randomBytes(48).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
const form=(path,body,headers={})=>fetch(base+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(body)});
const registered=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Pensieve deployment proof',redirect_uris:[redirect],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'})});assert.equal(registered.status,201);
const {client_id}=await registered.json();
const pending=await fetch(base+'/authorize?'+new URLSearchParams({client_id,response_type:'code',redirect_uri:redirect,code_challenge:challenge,code_challenge_method:'S256',scope:'memories',resource:base+'/mcp',state:'deployment-proof'}),{redirect:'manual'});assert.equal(pending.status,200);
const html=await pending.text(),nonce=html.match(/name="nonce" value="([^"]+)"/)?.[1];assert.ok(nonce);
const consent=await form('/connector/consent',{nonce,credential,decision:'approve'},{Origin:base,Cookie:pending.headers.get('set-cookie').split(';')[0]});assert.equal(consent.status,302);
const code=new URL(consent.headers.get('location')).searchParams.get('code');assert.ok(code);
const exchanged=await form('/token',{grant_type:'authorization_code',client_id,code,code_verifier:verifier,redirect_uri:redirect,resource:base+'/mcp'});assert.equal(exchanged.status,200);
const {access_token}=await exchanged.json();const client=new Client({name:'pensieve-deployment-proof',version:'1'});
try{await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+access_token}}}));const listed=await client.listTools();assert.ok(listed.tools.some(t=>t.name==='save_memory'));const pools=await client.callTool({name:'list_pools',arguments:{}});assert.ok(!pools.isError);console.log(JSON.stringify({oauthConsent:true,pkceExchange:true,mcpTools:listed.tools.length,listPools:true}));}finally{await client.close();assert.equal((await form('/revoke',{client_id,token:access_token})).status,200);}
