import {randomUUID} from 'node:crypto';
import type {RepositoryService,ConnectedRepository} from './repository-service.js';
import type {EmbeddingProvider,Memory} from './types.js';
import {validateMemoryRecord} from './memory-record.js';
import {repositoryKnowledgePrefix} from './repository-knowledge.js';

interface Publication {id:string;repositoryId:string;actor:string;revision:string;expectedRepositoryVersion:number;ids:string[];expires:number;committed?:boolean}
/** Receives derived evidence from a producer. Consumers only need Pensieve. */
export class RepositoryPublication {
 constructor(private service:RepositoryService,private provider?:EmbeddingProvider){}
 async begin(actor:string,repositoryId:string,revision:string){
  const repo=await this.service.publicationAllowed(actor,repositoryId);
  if(!/^[a-f0-9]{40,64}$/.test(revision))throw Error('Committed source revision required');
  if(repo.value.lease&&(repo.value.lease.until>Date.now()))throw Error('Repository is busy');
  const value:Publication={id:randomUUID(),repositoryId,actor,revision,expectedRepositoryVersion:repo.revision,ids:[],expires:Date.now()+3600000};
  if(!await this.service.records.compareAndSet('publication:'+value.id,'publications:'+repositoryId,undefined,value))throw Error('Publication conflict');
  return {publicationId:value.id,repository:repo.value,revision};
 }
 private async get(actor:string,publicationId:string){
  if(!/^[a-f0-9-]{36}$/.test(publicationId))throw Error('Invalid publication');
  const row=await this.service.records.get<Publication>('publication:'+publicationId);
  if(!row||row.value.actor!==actor||row.value.expires<Date.now())throw Error('Publication unavailable');
  await this.service.publicationAllowed(actor,row.value.repositoryId);return row;
 }
 async append(actor:string,publicationId:string,values:unknown[]){
  const row=await this.get(actor,publicationId),publication=row.value;
  if(publication.committed||!Array.isArray(values)||!values.length||values.length>16)throw Error('Invalid publication batch');
  const memories:Memory[]=values.map(validateMemoryRecord);
  for(const memory of memories){
   if(memory.project!==repositoryKnowledgePrefix+publication.repositoryId||memory.session!==publication.id||!memory.citations?.length||memory.citations.some(c=>{
    try{const u=new URL(c);return u.protocol!=='pensieve-code:'||u.hostname!==publication.repositoryId||u.searchParams.get('rev')!==publication.revision;}catch{return true;}
   }))throw Error('Publication evidence has mismatched repository or revision');
  }
  const ids=[...new Set([...publication.ids,...memories.map(m=>m.id)])];if(ids.length>4000)throw Error('Repository knowledge limit exceeded');
  const repo=await this.service.publicationAllowed(actor,publication.repositoryId);
  if(repo.revision!==publication.expectedRepositoryVersion)throw Error('Repository changed; start a new publication');
  await this.service.teams.putMemories(actor,repo.value.poolId,memories);
  if(!await this.service.records.compareAndSet('publication:'+publicationId,'publications:'+publication.repositoryId,row.revision,{...publication,ids}))throw Error('Concurrent publication batch; retry');
  return {accepted:ids.length};
 }
 async finish(actor:string,publicationId:string){
  const row=await this.get(actor,publicationId),publication=row.value;
  const repo=await this.service.publicationAllowed(actor,publication.repositoryId);
  if(!publication.committed){
   if(repo.revision!==publication.expectedRepositoryVersion)throw Error('Repository changed; start a new publication');
   const next:ConnectedRepository={...repo.value,sourceRevision:publication.revision,knowledge:{session:publication.id,revision:publication.revision,ids:publication.ids,publishedAt:new Date().toISOString(),indexing:'pending'}};
   // Remote producers do not supply a server-side graph artifact.
   delete next.sourceKey;delete next.artifactKey;delete next.indexedRevision;delete next.indexedAt;
   if(!await this.service.records.compareAndSetMany([
    {key:'repo:'+repo.value.id,partition:'pool:'+repo.value.poolId,expected:repo.revision,value:next},
    {key:'publication:'+publication.id,partition:'publications:'+publication.repositoryId,expected:row.revision,value:{...publication,committed:true}}
   ]))throw Error('Publication changed; retry completion');
  }
  let indexing:'pending'|'queued'|'complete'='pending';
  if(this.provider){try{await this.service.teams.index(actor,repo.value.poolId,this.provider);indexing=this.service.teams.indexingMode==='queued'?'queued':'complete';}catch{/* Publication is durable; indexing can be retried independently. */}}
  return {published:true,repositoryId:publication.repositoryId,poolId:repo.value.poolId,revision:publication.revision,records:publication.ids.length,indexing};
 }
}
