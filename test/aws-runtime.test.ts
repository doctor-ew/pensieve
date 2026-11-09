import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {APIGatewayProxyEventV2,Context} from 'aws-lambda';
import {lambdaAdapter,createCachedHandler} from '../src/aws-handler.js';
const event=(path='/'):APIGatewayProxyEventV2=>({version:'2.0',routeKey:'$default',rawPath:path,rawQueryString:'',headers:{host:'pensieve.example.com',origin:'https://pensieve.example.com'},requestContext:{accountId:'test',apiId:'test',domainName:'pensieve.example.com',domainPrefix:'test',http:{method:'GET',path,protocol:'HTTP/1.1',sourceIp:'192.0.2.1',userAgent:'test'},requestId:'test',routeKey:'$default',stage:'$default',time:'',timeEpoch:0},isBase64Encoded:false});
test('Lambda adapter preserves host/origin/source IP and separate session cookies',async()=>{
 const server=createServer((req,res)=>{assert.equal(req.headers.host,'pensieve.example.com');assert.equal(req.headers.origin,'https://pensieve.example.com');assert.equal(req.socket.remoteAddress,'192.0.2.1');res.setHeader('Set-Cookie',['a=1; HttpOnly','b=2; HttpOnly']);res.end('ok');});
 const context={} as Context;const response=await lambdaAdapter(server)(event(),context);
 assert.equal(response.statusCode,200);assert.deepEqual(response.cookies,['a=1; HttpOnly','b=2; HttpOnly']);assert.equal(context.callbackWaitsForEmptyEventLoop,false);
});
test('Lambda adapter rejects oversized requests before application processing',async()=>{
 let calls=0;const adapter=lambdaAdapter(createServer((_req,res)=>{calls++;res.end();}));
 const input={...event(),body:'x'.repeat(4_000_001)};assert.equal((await adapter(input,{} as Context)).statusCode,413);assert.equal(calls,0);
});

test('edge rejects direct origin requests before loading runtime and retains viewer Origin',async()=>{
 let loads=0;
 const handler=createCachedHandler(async()=>{loads++;return{current:async()=>true,close:()=>{},invoke:async request=>{assert.equal(request.headers.host,'pensieve.example.com');assert.equal(request.headers.origin,'https://foreign.example');assert.equal(request.headers['x-pensieve-edge-token'],undefined);return{statusCode:200};}};},()=>({token:'test-edge-token',publicUrl:'https://pensieve.example.com'}));
 assert.equal((await handler(event(),{} as Context)).statusCode,403);assert.equal(loads,0);
 const request=event();request.headers={host:'origin.execute-api.example','x-pensieve-edge-token':'test-edge-token',origin:'https://foreign.example'};
 assert.equal((await handler(request,{} as Context)).statusCode,200);assert.equal(loads,1);
});
test('warm runtime reloads when the authoritative issuer changes',async()=>{
 let issuer=1,loads=0,closed=0;
 const handler=createCachedHandler(async()=>{loads++;const loaded=issuer;return{current:async()=>loaded===issuer,close:()=>{closed++;},invoke:async()=>({statusCode:200,body:String(loaded)})};},()=>({}));
 assert.equal((await handler(event(),{} as Context)).body,'1');issuer=2;
 assert.equal((await handler(event(),{} as Context)).body,'2');assert.equal(loads,2);assert.equal(closed,1);
});

test('Lambda MCP initialization preserves headers through the Node/Web transport',async()=>{
 const {McpServer}=await import('@modelcontextprotocol/sdk/server/mcp.js');
 const {StreamableHTTPServerTransport}=await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
 const server=createServer(async(req,res)=>{
  const mcp=new McpServer({name:'adapter-proof',version:'1'});
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{void transport.close();void mcp.close();});
  await mcp.connect(transport);await transport.handleRequest(req,res);
 });
 const input=event('/mcp');input.requestContext.http.method='POST';
 input.headers={...input.headers,'content-type':'application/json',accept:'application/json, text/event-stream'};
 input.body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'proof',version:'1'}}});
 const response=await lambdaAdapter(server)(input,{} as Context);
 assert.equal(response.statusCode,200,response.body);assert.equal(JSON.parse(response.body!).result.serverInfo.name,'adapter-proof');
});
