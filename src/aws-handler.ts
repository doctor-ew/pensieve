import serverless from 'serverless-http';
import {timingSafeEqual} from 'node:crypto';
import type {Server,IncomingMessage} from 'node:http';
import type {APIGatewayProxyEventV2,APIGatewayProxyStructuredResultV2,Context} from 'aws-lambda';

/** Buffered HTTP API transport. MCP is stateless JSON, not an indefinitely open SSE session. */
export function lambdaAdapter(server:Server){
 const invoke=serverless(server,{request:(request:IncomingMessage)=>{
  // serverless-http supplies normalized headers but leaves rawHeaders empty.
  // MCP's Node/Web adapter reads rawHeaders for Content-Type and Accept.
  request.rawHeaders=Object.entries(request.headers).flatMap(([name,value])=>
   value===undefined?[]:Array.isArray(value)?value.flatMap(item=>[name,item]):[name,value]);
 }});
 return async(event:APIGatewayProxyEventV2,context:Context):Promise<APIGatewayProxyStructuredResultV2>=>{
  context.callbackWaitsForEmptyEventLoop=false;
  if(event.version!=='2.0'||!event.requestContext?.http)return{statusCode:400,body:'Unsupported request'};
  const size=Buffer.byteLength(event.body??'',event.isBase64Encoded?'base64':'utf8');
  if(size>4_000_000)return{statusCode:413,body:'Request too large; use smaller batches'};
  // The adapter retains Host, Origin and API Gateway's trusted source IP for application checks.
  const response=await invoke(event,context) as APIGatewayProxyStructuredResultV2;
  if(Buffer.byteLength(response.body??'')>5_500_000)return{statusCode:413,body:'Response too large; reduce selection'};
  return response;
 };
}
export interface CachedRuntime {invoke:ReturnType<typeof lambdaAdapter>;current:()=>Promise<boolean>;close:()=>void;observe?:(event:APIGatewayProxyEventV2,response:APIGatewayProxyStructuredResultV2)=>Promise<void>}
async function load():Promise<CachedRuntime>{
 const module=await import('./aws-runtime.js'),runtime=await module.createAwsRuntime();
 return{invoke:lambdaAdapter(runtime.server),current:async()=>(await runtime.db.get('SYSTEM','ISSUER'))?.value===runtime.store.sourceServer,close:runtime.close,observe:runtime.observe};
}
export function createCachedHandler(loader:()=>Promise<CachedRuntime>,edge:()=>{token?:string;publicUrl?:string}=()=>({token:process.env.PENSIEVE_EDGE_TOKEN,publicUrl:process.env.PENSIEVE_PUBLIC_URL})){
 let cached:Promise<CachedRuntime>|undefined;
 return async(event:APIGatewayProxyEventV2,context:Context):Promise<APIGatewayProxyStructuredResultV2>=>{
 const config=edge();
 if(config.token){
  const incoming=event.headers?.['x-pensieve-edge-token']??'';
  const actual=Buffer.from(incoming),expected=Buffer.from(config.token);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return{statusCode:403,headers:{'Cache-Control':'no-store'},body:'Forbidden'};
  if(!config.publicUrl)return{statusCode:503,body:'Service temporarily unavailable'};
  // Only the authenticated edge can normalize Host; viewer Origin remains checked by the app.
  const headers:APIGatewayProxyEventV2['headers']={...event.headers,host:new URL(config.publicUrl).host};
  delete headers['x-pensieve-edge-token'];
  event={...event,headers};
 }

 try{
  cached??=loader().catch(error=>{cached=undefined;throw error;});
  let runtime=await cached;
  if(!await runtime.current()){runtime.close();cached=loader().catch(error=>{cached=undefined;throw error;});runtime=await cached;}
  const response=await runtime.invoke(event,context);await runtime.observe?.(event,response);return response;
 }catch{
  console.warn('Pensieve request unavailable');
  return{statusCode:503,headers:{'Cache-Control':'no-store'},body:JSON.stringify({error:'Service temporarily unavailable'})};
 }
 };
}
export const handler=createCachedHandler(load);
