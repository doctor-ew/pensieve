import {RepositoryPublication} from './repository-publication.js';
import type {EmbeddingProvider} from './types.js';
import {installRepositoryRecall,type RepositoryKnowledge} from './repository-knowledge.js';
import {resolvePolicy} from './policy.js';
import {randomUUID} from 'node:crypto';
import type {TeamRepository} from './repositories.js';
import type {RepositoryRecords,VersionedRecord} from './repository-records.js';
import {validateSnapshot,type SourceFile,type RepositoryBlobs} from './repository-artifacts.js';
import type {MexRequest,MexResult} from './mex-runtime.js';
export interface ConnectedRepository {id:string;poolId:string;name:string;source:{kind:'upload'}|{kind:'git';url:string;branch:string};autoRefresh:boolean;createdBy:string;createdAt:string;sourceKey?:string;sourceRevision?:string;artifactKey?:string;indexedRevision?:string;indexedAt?:string;lease?:{jobId:string;token:string;until:number};lastError?:string;knowledge?:RepositoryKnowledge}
export interface RepositoryJob {id:string;repositoryId:string;poolId:string;actor:string;request:MexRequest;state:'pending'|'running'|'succeeded'|'failed';createdAt:string;attempts:number;lease?:{token:string;until:number};resultKey?:string;error?:string;finishedAt?:string;sourceRevision?:string}
interface Upload {id:string;repositoryId:string;actor:string;revision:string;chunks:string[];count:number;bytes:number;expires:number;committed?:boolean}
const writableOperations=new Set(['build','refresh','repair','note','edit','retire']);
const id=(value:string)=>{if(!/^[a-f0-9-]{36}$/.test(value))throw Error('Invalid repository identifier');return value;};
export class RepositoryService {
 readonly publications:RepositoryPublication;
 readonly executionAvailable=false;
 constructor(readonly teams:TeamRepository,readonly records:RepositoryRecords,readonly blobs:RepositoryBlobs,private provider?:EmbeddingProvider){installRepositoryRecall(teams,records);this.publications=new RepositoryPublication(this,provider);}
 async authorized(actor:string,repositoryId:string,write=false):Promise<VersionedRecord<ConnectedRepository>>{const record=await this.records.get<ConnectedRepository>('repo:'+id(repositoryId));if(!record)throw Error('Repository unavailable');const pool=await this.teams.getPool(actor,record.value.poolId);if(write&&pool.role==='reader')throw Error('Writer access required');return record;}
 async create(actor:string,input:{poolId:string;name:string;source:ConnectedRepository['source'];autoRefresh:boolean}){
  const pool=await this.teams.getPool(actor,input.poolId);if(pool.role==='reader')throw Error('Writer access required');if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||typeof input.autoRefresh!=='boolean')throw Error('Invalid repository settings');
  if(input.source.kind==='git'){const url=new URL(input.source.url);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.hostname!=='github.com'||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(url.pathname)||typeof input.source.branch!=='string'||!input.source.branch||input.source.branch.length>200||input.source.branch.startsWith('-')||/[\s\x00-\x1f]/.test(input.source.branch))throw Error('Use a GitHub HTTPS repository and explicit branch');}else if(input.source.kind!=='upload')throw Error('Unsupported repository source');
  const value:ConnectedRepository={id:randomUUID(),poolId:pool.id,name:input.name.trim(),source:input.source,autoRefresh:input.autoRefresh,createdBy:actor,createdAt:new Date().toISOString()};
  if(!await this.records.compareAndSet('repo:'+value.id,'pool:'+pool.id,undefined,value))throw Error('Repository creation conflict');return value;
 }
 async publicationAllowed(actor:string,repositoryId:string){
  const repo=await this.authorized(actor,repositoryId,true),pool=await this.teams.getPool(actor,repo.value.poolId);
  const layers=await this.teams.getPolicies(actor,pool.id,'repository:'+repositoryId);
  const policy=resolvePolicy({team:pool.visibility==='shared'?{destination:'shared',pool:pool.id}:{destination:'private'},...layers});
  if(policy.destination==='off'||(policy.destination==='private'&&pool.visibility!=='private')||(policy.destination==='shared'&&policy.pool!==pool.id))throw Error('Capture policy blocks repository publication');
  return repo;
 }
 private summary(repo:ConnectedRepository){const {knowledge,...rest}=repo;return {...rest,...(knowledge?{knowledge:{formatVersion:knowledge.formatVersion??1,session:knowledge.session,revision:knowledge.revision,publishedAt:knowledge.publishedAt,records:knowledge.ids.length,indexing:'pending-verification'}}:{})};}
 async status(actor:string,repositoryId:string){
  const repo=(await this.authorized(actor,repositoryId)).value;const result=this.summary(repo);
  if(repo.knowledge&&this.provider&&this.teams.indexedMemoryCount){const indexed=await this.teams.indexedMemoryCount(actor,repo.poolId,repo.knowledge.ids,this.provider.identity);return {...result,knowledge:{...result.knowledge,indexed,indexing:indexed===repo.knowledge.ids.length?'complete':'pending'}};}
  return result;
 }
 async list(actor:string,poolId:string,cursor?:string){await this.teams.getPool(actor,poolId);const page=await this.records.list<ConnectedRepository>('pool:'+poolId,cursor);return {...page,items:page.items.map(r=>({...r,value:this.summary(r.value)}))};}

 async beginUpload(actor:string,repositoryId:string,revision:string){const repo=await this.authorized(actor,repositoryId,true);if(repo.value.source.kind!=='upload'||!(/^[a-f0-9]{40,64}$/).test(revision))throw Error('Invalid upload revision');const upload:Upload={id:randomUUID(),repositoryId,actor,revision,chunks:[],count:0,bytes:0,expires:Date.now()+3600000};await this.records.compareAndSet('upload:'+upload.id,'uploads:'+repositoryId,undefined,upload);return {uploadId:upload.id};}
 private async upload(actor:string,uploadId:string){const record=await this.records.get<Upload>('upload:'+id(uploadId));if(!record||record.value.actor!==actor||record.value.expires<=Date.now()||record.value.committed)throw Error('Upload unavailable');await this.authorized(actor,record.value.repositoryId,true);return record;}
 async uploadFiles(actor:string,uploadId:string,files:SourceFile[]){const record=await this.upload(actor,uploadId),upload=record.value;validateSnapshot({version:1,revision:upload.revision,files});if(files.length>16)throw Error('Upload at most 16 files per request');const bytes=files.reduce((n,f)=>n+Buffer.byteLength(f.content,'base64'),0);if(upload.bytes+bytes>25000000||upload.count+files.length>5000)throw Error('Repository upload limit exceeded');const key=`uploads/${upload.id}/${randomUUID()}.json`;await this.blobs.put(key,Buffer.from(JSON.stringify(files)));upload.chunks.push(key);upload.bytes+=bytes;upload.count+=files.length;if(!await this.records.compareAndSet('upload:'+upload.id,'uploads:'+upload.repositoryId,record.revision,upload))throw Error('Concurrent upload; retry after checking upload status');return {files:upload.count,bytes:upload.bytes};}
 async finishUpload(actor:string,uploadId:string){const upload=await this.upload(actor,uploadId);const files:SourceFile[]=[];for(const key of upload.value.chunks)files.push(...JSON.parse(Buffer.from(await this.blobs.get(key)).toString('utf8')) as SourceFile[]);const snapshot=validateSnapshot({version:1,revision:upload.value.revision,files});const repo=await this.authorized(actor,upload.value.repositoryId,true);if(repo.value.lease&&repo.value.lease.until>Date.now())throw Error('Repository busy; retry after its current job');const key=`sources/${repo.value.id}/${randomUUID()}.json`;await this.blobs.put(key,Buffer.from(JSON.stringify(snapshot)));if(!await this.records.compareAndSet('repo:'+repo.value.id,'pool:'+repo.value.poolId,repo.revision,{...repo.value,sourceKey:key,sourceRevision:snapshot.revision}))throw Error('Repository changed; retry upload completion');await this.records.compareAndSet('upload:'+upload.value.id,'uploads:'+repo.value.id,upload.revision,{...upload.value,committed:true});return this.enqueue(actor,repo.value.id,{operation:'build'});}
 async enqueue(actor:string,repositoryId:string,request:MexRequest){const repo=await this.authorized(actor,repositoryId,writableOperations.has(request.operation));const allowed=['build','refresh','repair','status','definitions','callers','callees','scope','source','impact','check','note','recall','edit','retire','brief'];if(!allowed.includes(request.operation)||JSON.stringify(request).length>14000)throw Error('Unsupported repository operation');const job:RepositoryJob={id:randomUUID(),repositoryId,poolId:repo.value.poolId,actor,request,state:'pending',createdAt:new Date().toISOString(),attempts:0,sourceRevision:repo.value.sourceRevision};await this.records.compareAndSet('job:'+job.id,'jobs:'+repositoryId,undefined,job);return job;}
 async job(actor:string,jobId:string){const record=await this.records.get<RepositoryJob>('job:'+id(jobId));if(!record)throw Error('Job unavailable');await this.authorized(actor,record.value.repositoryId);const job=record.value;return {...job,...(job.resultKey?{result:JSON.parse(Buffer.from(await this.blobs.get(job.resultKey)).toString('utf8')) as MexResult}:{})};}
 async jobs(actor:string,repositoryId:string,cursor?:string){await this.authorized(actor,repositoryId);return this.records.list<RepositoryJob>('jobs:'+repositoryId,cursor);}
}
export {writableOperations};
