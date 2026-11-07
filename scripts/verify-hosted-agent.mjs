// Explicit live smoke: creates synthetic account/pools, then revokes account.
// Credentials are read from private files; never emitted.
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {TeamClient} from '../dist/team-client.js';
const setup=join(homedir(),'.pensieve/railway-team');
const operator=JSON.parse(await readFile(join(setup,'operator.json'),'utf8'));
const url=operator.url;
async function admin(path,body){
 const res=await fetch(url+'/api/team/admin/users'+path,{method:'POST',headers:{Authorization:'Bearer '+operator.ownerToken,'Content-Type':'application/json'},body:JSON.stringify(body??{}),signal:AbortSignal.timeout(180000)});
 assert.ok(res.ok,'Admin request status '+res.status);return res.json();
}
const invitation=await admin('',{name:'Synthetic agent connectivity verification'});
const team=new TeamClient(url,invitation.token);
const client=new Client({name:'pensieve-live-proof',version:'1'});
try{
 const pool=await team.createPool('Synthetic agent test','private');
 await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/cli.js','mcp'],cwd:process.cwd(),env:{PENSIEVE_TEAM_URL:url,PENSIEVE_TEAM_TOKEN:invitation.token},stderr:'pipe'}));
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result;};
 await call('save_memory',{poolId:pool.id,text:'Synthetic decision: we chose SQLite to support disconnected engineering work without requiring network connectivity.',conversation:'synthetic-verification',synthetic:true});
 // Warm the public model download with a longer first-use deadline.
 const warm=await fetch(url+'/api/team/pools/'+pool.id+'/index',{method:'POST',headers:{Authorization:'Bearer '+invitation.token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(180000)});
 assert.ok(warm.ok,'Initial indexing status '+warm.status);
 await call('index_memories',{poolId:pool.id});
 const recall=await call('recall_memories',{poolId:pool.id,query:'Why was local storage selected for offline development?'});
 assert.ok(JSON.stringify(recall).includes('disconnected engineering'));
 console.log(JSON.stringify({status:'passed',host:url,tools:(await client.listTools()).tools.map(t=>t.name),save:true,index:true,semanticRecall:true,synthetic:true}));
}finally{await client.close();await admin('/'+invitation.user.id+'/revoke');}
const drew=new Client({name:'configured-account-proof',version:'1'});
try{
 await drew.connect(new StdioClientTransport({command:process.execPath,args:['dist/cli.js','mcp','--home',join(homedir(),'.pensieve/railway-client')],cwd:process.cwd(),stderr:'pipe'}));
 const result=await drew.callTool({name:'list_pools',arguments:{}});
 assert.ok(!result.isError);
 console.log(JSON.stringify({configuredPersonalAccount:'passed',tools:(await drew.listTools()).tools.length}));
}finally{await drew.close();}
