import test from 'node:test';
import assert from 'node:assert/strict';
import type {APIGatewayProxyEventV2} from 'aws-lambda';
import {httpAudit} from '../src/aws-http-audit.js';
import type {AwsAudit} from '../src/aws-audit.js';
import type {HostedSessions} from '../src/hosted-sessions.js';
import type {TeamRepository} from '../src/repositories.js';
const event=(path:string,method='GET')=>({rawPath:path,headers:{authorization:'Bearer never-log-this'},requestContext:{requestId:'request-1',http:{method}}}) as APIGatewayProxyEventV2;
test('reader auditing records successful access only and never grant or memory content',async()=>{
 const records:unknown[]=[];const audit={record:async(value:unknown)=>{records.push(value);}} as unknown as AwsAudit;
 const observe=httpAudit(audit,{} as HostedSessions,{} as TeamRepository);const request=event('/api/reader/'+'a'.repeat(32));
 await observe(request,{statusCode:401,body:'Denied'});assert.equal(records.length,0);
 await observe(request,{statusCode:200,body:'PRIVATE MEMORY CONTENT'});assert.equal(records.length,1);
 const json=JSON.stringify(records);assert.match(json,/share.open/);assert.doesNotMatch(json,/PRIVATE|never-log|Bearer/);
 await observe(event('/api/reader/'+'a'.repeat(32)+'/download'),{statusCode:200});assert.match(JSON.stringify(records),/share.download/);
});
test('authenticated memory reads identify the actor without recording query text',async()=>{
 const records:unknown[]=[];const observe=httpAudit({record:async(value:unknown)=>{records.push(value);}} as unknown as AwsAudit,{} as HostedSessions,{authenticate:async()=>({id:'actor-id',name:'Name'})} as unknown as TeamRepository);
 const request={...event('/api/team/pools/pool-id/search','POST'),body:'{"query":"private project"}'};await observe(request,{statusCode:200,body:'private result'});
 assert.deepEqual(records,[{id:'http:request-1',action:'memory.search',actorId:'actor-id',poolId:'pool-id',targetId:'pool-id',outcome:'success'}]);
});
