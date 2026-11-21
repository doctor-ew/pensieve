import {repositoryKnowledge} from './repository-knowledge.js';
import type {SourceSnapshot} from './repository-artifacts.js';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {RepositoryService,writableOperations,type RepositoryJob,type ConnectedRepository} from './repository-service.js';
import {packWorkspace,unpackWorkspace,unpackSources,validateSnapshot} from './repository-artifacts.js';
import {MexRuntime,type MexResult} from './mex-runtime.js';

/** One leased repository at a time. Artifacts are immutable; CAS publishes their pointer. */
export class RepositoryWorker {
 constructor(private service:RepositoryService,private engine=new MexRuntime(),private workRoot=join(tmpdir(),'pensieve-mex-work')){}
 async process(jobId:string):Promise<void>{
  const {records,blobs}=this.service;let jobRow=await records.get<RepositoryJob>('job:'+jobId);if(!jobRow||jobRow.value.state==='succeeded'||jobRow.value.state==='failed')return;
  if(jobRow.value.state==='running'&&(jobRow.value.lease?.until??0)>Date.now())throw Error('Repository job already leased');
  const token=randomUUID(),until=Date.now()+180000;const job:RepositoryJob={...jobRow.value,state:'running',attempts:jobRow.value.attempts+1,lease:{token,until}};
  if(job.attempts>5)throw Error('Repository job retry budget exceeded');
  if(!await records.compareAndSet('job:'+jobId,'jobs:'+job.repositoryId,jobRow.revision,job))throw Error('Repository job claim conflict');
  jobRow={revision:jobRow.revision+1,value:job};let repoRow:Awaited<ReturnType<RepositoryService['authorized']>>|undefined;let acquired=false,ownsWorkspace=false;let lock:DatabaseSync|undefined;
  const workspace=join(this.workRoot,job.repositoryId),repository=join(workspace,'repository'),state=join(workspace,'state');
  try{
   repoRow=await this.service.authorized(job.actor,job.repositoryId,writableOperations.has(job.request.operation));
   if(repoRow.value.lease&&repoRow.value.lease.until>Date.now())throw Error('Repository is busy');
   if(!await records.compareAndSet('repo:'+job.repositoryId,'pool:'+job.poolId,repoRow.revision,{...repoRow.value,lease:{jobId,token,until}}))throw Error('Repository claim conflict');
   acquired=true;repoRow={revision:repoRow.revision+1,value:{...repoRow.value,lease:{jobId,token,until}}};
   await mkdir(this.workRoot,{recursive:true,mode:0o700});
   lock=new DatabaseSync(join(this.workRoot,job.repositoryId+'.lock.sqlite'));lock.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');ownsWorkspace=true;
   if(job.sourceRevision!==repoRow.value.sourceRevision)throw Error('Source changed after this job was queued');
   await rm(workspace,{recursive:true,force:true});await mkdir(workspace,{mode:0o700});
   if(repoRow.value.artifactKey)await unpackWorkspace(workspace,await blobs.get(repoRow.value.artifactKey));
   let sourceRevision=repoRow.value.indexedRevision;let sourceSnapshot:SourceSnapshot|undefined;
   if(['build','refresh','repair'].includes(job.request.operation)){
    if(!repoRow.value.sourceKey)throw Error('Repository source has not been uploaded');
    const snapshot=sourceSnapshot=validateSnapshot(JSON.parse(Buffer.from(await blobs.get(repoRow.value.sourceKey)).toString('utf8')));
    // Keep MEX graph/notes only when the existing source tree can be refreshed safely.
    // A clean source snapshot is authoritative; the state directory holds note history.
    await rm(repository,{recursive:true,force:true});await unpackSources(repository,snapshot);sourceRevision=snapshot.revision;
   }else if(!repoRow.value.artifactKey||repoRow.value.indexedRevision!==repoRow.value.sourceRevision)throw Error('Build the current repository revision before querying it');
   await mkdir(state,{recursive:true,mode:0o700});
   const request=['refresh','repair'].includes(job.request.operation)?{...job.request,operation:'build' as const}:job.request;
   const raw=await this.engine.run(repository,state,request,{timeoutMs:120000});
   let knowledge=repoRow.value.knowledge;
   if(sourceSnapshot){
    const memories=repositoryKnowledge(repository,sourceSnapshot,repoRow.value,jobId);
    for(let offset=0;offset<memories.length;offset+=16){
     await this.service.publicationAllowed(job.actor,job.repositoryId);
     if(Date.now()>=until)throw Error('Repository publication lease expired');
     await this.service.teams.putMemories(job.actor,job.poolId,memories.slice(offset,offset+16));
    }
    await this.service.publicationAllowed(job.actor,job.repositoryId);
    knowledge={session:jobId,revision:sourceSnapshot.revision,ids:memories.map(m=>m.id),publishedAt:new Date().toISOString(),indexing:'pending'};
   }
   const redact=(value:unknown):unknown=>typeof value==='string'?value.split(repository).join('repository://'+job.repositoryId).split(state).join('repository-state://'+job.repositoryId):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v)])):value;
   const result={...redact(raw) as MexResult,repositoryId:job.repositoryId,sourceRevision};const resultKey=`results/${job.repositoryId}/${jobId}/${token}.json`;await blobs.put(resultKey,Buffer.from(JSON.stringify(result)));
   await this.service.authorized(job.actor,job.repositoryId,writableOperations.has(job.request.operation));
   if(Date.now()>=until)throw Error('Repository job lease expired');
   const changed=writableOperations.has(job.request.operation);
   const artifactKey=changed?`artifacts/${job.repositoryId}/${token}.json.gz`:repoRow.value.artifactKey;
   if(changed)await blobs.put(artifactKey!,await packWorkspace(workspace));
   await rm(workspace,{recursive:true,force:true});ownsWorkspace=false;
   const next:ConnectedRepository={...repoRow.value,knowledge,artifactKey,indexedRevision:sourceRevision,...(['build','refresh','repair'].includes(job.request.operation)?{indexedAt:new Date().toISOString()}: {})};delete next.lease;delete next.lastError;
   if(!await records.compareAndSetMany([
    {key:'repo:'+job.repositoryId,partition:'pool:'+job.poolId,expected:repoRow.revision,value:next},
    {key:'job:'+jobId,partition:'jobs:'+job.repositoryId,expected:jobRow.revision,value:{...job,state:'succeeded',resultKey,sourceRevision,finishedAt:new Date().toISOString(),lease:undefined}}
   ]))throw Error('Repository or job changed before publication');
   acquired=false;
  }catch{
   const current=await records.get<RepositoryJob>('job:'+jobId);if(current?.value.lease?.token===token)await records.compareAndSet('job:'+jobId,'jobs:'+job.repositoryId,current.revision,{...current.value,state:'failed',error:'Repository operation failed. Check source access, repository freshness, input and engine limits.',finishedAt:new Date().toISOString(),lease:undefined});
  }finally{
   if(ownsWorkspace)await rm(workspace,{recursive:true,force:true});
   if(lock){try{lock.exec('ROLLBACK');}catch{}lock.close();}
   if(acquired&&repoRow){const current=await records.get<ConnectedRepository>('repo:'+job.repositoryId);if(current?.value.lease?.token===token){const next={...current.value};delete next.lease;await records.compareAndSet('repo:'+job.repositoryId,'pool:'+job.poolId,current.revision,next);}}

  }
 }
}
