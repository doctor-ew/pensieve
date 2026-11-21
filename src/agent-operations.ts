import type {TeamRepository} from './repositories.js';
import type {EmbeddingProvider,Memory,Bundle} from './types.js';
import {resolvePolicy,validateCapturePolicy} from './policy.js';
import {validateMemoryRecord} from './memory-record.js';

/** Explicit CLI operations over the audience-bound MCP transport. Never forwards HTTP requests. */
export async function agentOperation(store:TeamRepository,actor:string,path:string,body:unknown,provider?:EmbeddingProvider){
  if(path.length>2000||! /^(me|pools)(?:[/?]|$)/.test(path))throw Error('Unsupported agent operation');
  const url=new URL('/'+path,'http://operation.invalid');
  const input=body===undefined?undefined:body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:undefined;
  if(body!==undefined&&!input)throw Error('Expected operation object');
  for(const key of ['repository','conversation'])if(input?.[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>4096))throw Error('Invalid capture context');
  const user=await store.getUser(actor);
  if(url.pathname==='/me'&&!input)return {user};
  if(url.pathname==='/pools'){
    if(!input)return {pools:await store.listPools(actor)};
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||!['private','shared'].includes(String(input.visibility)))throw Error('Invalid pool');
    return {pool:await store.createPool(actor,input.name,input.visibility as 'private'|'shared')};
  }
  const match=/^\/pools\/([a-zA-Z0-9_-]{1,128})\/(memories|export|index|search|policy)$/.exec(url.pathname);
  if(!match)throw Error('Unsupported agent operation');
  const [,poolId,action]=match,pool=await store.getPool(actor,poolId);
  const writer=()=>{if(pool.role==='reader')throw Error('Writer access required');};
  if(!input){
    if(action==='memories')return store.listMemoryPage?await store.listMemoryPage(actor,poolId,{limit:50,cursor:url.searchParams.get('cursor')??undefined}):{memories:await store.listMemories(actor,poolId)};
    if(action==='policy'){
      const repository=url.searchParams.get('repository')??undefined,conversation=url.searchParams.get('conversation')??undefined;
      const policies=await store.getPolicies(actor,poolId,repository,conversation);return {policies,effective:resolvePolicy(policies)};
    }
    throw Error('Operation input required');
  }
  if(action==='memories'){
    writer();if(!Array.isArray(input.memories)||input.memories.length<1||input.memories.length>16)throw Error('Select 1–16 memories per batch');
    input.memories.forEach(validateMemoryRecord);
    const policies=await store.getPolicies(actor,poolId,input.repository as string|undefined,input.conversation as string|undefined);
    if(Object.keys(policies).length){const policy=resolvePolicy(policies);if(policy.destination==='off'||(policy.destination==='private'&&pool.visibility!=='private')||(policy.destination==='shared'&&policy.pool!==poolId))throw Error('Capture policy blocks publication');}
    return store.putMemories(actor,poolId,input.memories as Memory[],input.provenance as Bundle['provenance']);
  }
  if(action==='export'){
    if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100||input.ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw Error('Select 1–100 memory IDs');
    return store.exportBundle(actor,poolId,input.ids as string[]);
  }
  if(action==='policy'){
    writer();if(!['team','repository','conversation'].includes(String(input.scope))||typeof input.key!=='string'||input.key.length>4096)throw Error('Invalid capture scope');
    await store.setPolicy(actor,poolId,input.scope as 'team'|'repository'|'conversation',input.key,validateCapturePolicy(input.policy));
    const policies=await store.getPolicies(actor,poolId,input.repository as string|undefined,input.conversation as string|undefined);return {policies,effective:resolvePolicy(policies)};
  }
  if(!provider)throw Error('Embedding provider unavailable');
  if(action==='index'){writer();return {indexed:await store.index(actor,poolId,provider),...(store.indexingMode==='queued'?{queued:true}:{})};}
  if(typeof input.query!=='string'||!input.query.trim()||input.query.length>4000||input.limit!==undefined&&(!Number.isInteger(input.limit)||Number(input.limit)<1||Number(input.limit)>100))throw Error('Invalid search');
  return {hits:await store.search(actor,poolId,input.query,provider,input.limit as number|undefined)};
}
