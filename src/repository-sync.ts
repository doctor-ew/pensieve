import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {MexRuntime} from './mex-runtime.js';
import {repositoryKnowledge} from './repository-knowledge.js';
import {unpackSources,validateSnapshot,type SourceFile} from './repository-artifacts.js';
import type {ConnectedRepository} from './repository-service.js';
import type {TeamClient} from './team-client.js';
const execute=promisify(execFile);
/** Retry only idempotent publication operations with identical evidence. */
export async function retryPublication<T>(operation:()=>Promise<T>,wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))):Promise<T>{
 for(let attempt=0;;attempt++){
  try{return await operation();}catch(error){
   if(attempt>=5||(error as {code?:string}).code==='SIGN_IN_REQUIRED'||[401,403,404].includes((error as {status?:number}).status??0))throw error;
   await wait(Math.min(16000,1000*2**attempt));
  }
 }
}
/** Only committed, bounded source blobs are extracted; never run project setup. */
export async function committedRepositorySnapshot(path:string){
 const cwd=resolve(path);
 const git=async(args:string[],maxBuffer=4000000)=>(await execute('git',['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd,encoding:'utf8',timeout:30000,maxBuffer,env:{PATH:process.env.PATH,HOME:cwd,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1'}})).stdout;
 const revision=(await git(['rev-parse','--verify','HEAD^{commit}'])).trim();
 const entries=(await git(['ls-tree','-r','-z','--full-tree',revision])).split('\0').filter(Boolean);
 const files:SourceFile[]=[];let bytes=0;
 for(const entry of entries){
  const match=/^100(?:644|755) blob ([a-f0-9]+)\t(.+)$/s.exec(entry);if(!match)continue;
  const [,oid,file]=match;
  if(!/\.(?:[cm]?[jt]sx?|py|rs|cs)$/i.test(file)||file.split('/').some(p=>p.startsWith('.')||['node_modules','vendor','dist','build','coverage'].includes(p)))continue;
  const size=Number((await git(['cat-file','-s',oid])).trim());
  if(size>1000000)throw Error('Source file exceeds 1 MB extraction limit');
  bytes+=size;if(bytes>25000000||files.length>=5000)throw Error('Repository exceeds extraction limits');
  const content=Buffer.from(await git(['cat-file','blob',oid],1100000));
  if(content.includes(0))throw Error('Binary source is unsupported');
  files.push({path:file,content:content.toString('base64'),sha256:createHash('sha256').update(content).digest('hex')});
 }
 return validateSnapshot({version:1,revision,files});
}
export async function syncRepository(client:Pick<TeamClient,'request'>,repositoryId:string,path:string|undefined,engine=new MexRuntime()){
 const repo=await client.request<ConnectedRepository>('repositories/get',{repositoryId});
 const work=await mkdtemp(join(tmpdir(),'pensieve-publish-'));
 try{
  let input=path;
  if(repo.source.kind==='git'){
   if(path)throw Error('Connected Git repositories use their registered URL and branch');
   input=join(work,'git-source');
   const env:NodeJS.ProcessEnv={PATH:process.env.PATH,HOME:work,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'};
   if(process.env.PENSIEVE_GITHUB_TOKEN){env.GIT_CONFIG_COUNT='1';env.GIT_CONFIG_KEY_0='http.https://github.com/.extraHeader';env.GIT_CONFIG_VALUE_0='Authorization: Basic '+Buffer.from('x-access-token:'+process.env.PENSIEVE_GITHUB_TOKEN).toString('base64');}
   try{await execute('git',['-c','core.hooksPath=/dev/null','-c','http.followRedirects=false','clone','--bare','--depth','1','--single-branch','--branch',repo.source.branch,'--',repo.source.url,input],{env,timeout:120000,maxBuffer:1000000});}catch{throw Error('Git intake failed; check repository access, configured branch and PENSIEVE_GITHUB_TOKEN for private repositories');}
  }
  if(!input)throw Error('Local repository path required');
  const snapshot=await committedRepositorySnapshot(input);
  if(repo.knowledge?.revision===snapshot.revision)return {published:true,alreadyCurrent:true,repositoryId:repo.id,revision:snapshot.revision};
  const root=join(work,'repository');await mkdir(root);await unpackSources(root,snapshot);
  if(snapshot.files.length)await engine.run(root,join(work,'state'),{operation:'build'});
  const publication=await client.request<{publicationId:string;repository:ConnectedRepository}>('repositories/begin-publication',{repositoryId,revision:snapshot.revision});
  const memories=snapshot.files.length?repositoryKnowledge(root,snapshot,repo,publication.publicationId):[];
  for(let offset=0;offset<memories.length;offset+=16)await retryPublication(()=>client.request('repositories/append-publication',{publicationId:publication.publicationId,memories:memories.slice(offset,offset+16)}));
  return await retryPublication(()=>client.request('repositories/finish-publication',{publicationId:publication.publicationId}));
 }finally{await rm(work,{recursive:true,force:true});}
}
