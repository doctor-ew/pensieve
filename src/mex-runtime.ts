import {spawn} from 'node:child_process';
import {readFile,mkdir,realpath,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MEX_VERSION='0.9.0-beta.1.1';
export type MexOperation='build'|'refresh'|'repair'|'status'|'definitions'|'callers'|'callees'|'scope'|'source'|'impact'|'check'|'note'|'recall'|'edit'|'retire'|'brief';
export interface MexRequest {operation:MexOperation;target?:string;text?:string;limit?:number;depth?:number}
export interface MexResult {engine:string;operation:MexOperation;records:unknown[];exitCode:number}
export class MexRuntimeError extends Error {
 constructor(readonly code:'ENGINE_UNAVAILABLE'|'ENGINE_FAILED'|'INVALID_REQUEST'|'OUTPUT_LIMIT'|'TIMEOUT'|'CANCELLED',message:string){super(message);this.name='MexRuntimeError';}
}
const required=(value:string|undefined,max=4000)=>{if(!value?.trim()||value.length>max||value.includes('\0'))throw new MexRuntimeError('INVALID_REQUEST','Invalid MEX operation input');return value;};
function argumentsFor(input:MexRequest):string[]{
 const limit=input.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw new MexRuntimeError('INVALID_REQUEST','Limit must be 1–100');
 const bounded=['--max-nodes',String(limit),'--max-output-tokens','12000'];
 switch(input.operation){
  case 'build':return ['graph','--json'];
  case 'refresh':case 'repair':case 'status':return ['graph',input.operation,'--json'];
  case 'definitions':case 'callers':case 'callees':return ['graph','query',...bounded,'--',({definitions:'where-defined',callers:'who-calls',callees:'what-calls'} as const)[input.operation],required(input.target,512)];
  case 'scope':return ['graph','scope',...bounded,'--',required(input.target)];
  case 'source':return ['graph','get','--max-output-tokens','12000','--max-source-lines','200','--',required(input.target,512)];
  case 'impact':{const depth=input.depth??2;if(!Number.isInteger(depth)||depth<1||depth>8)throw new MexRuntimeError('INVALID_REQUEST','Depth must be 1–8');return ['impact',...bounded,'--depth',String(depth),'--',required(input.target,512)];}
  case 'check':return ['check','--json'];
  case 'note':return ['note','--json','--',required(input.text,10000)];
  case 'recall':return ['recall','--json','--',required(input.target)];
  case 'edit':return ['edit','--json','--',required(input.target,128),required(input.text,10000)];
  case 'retire':return ['wrong','--json','--',required(input.target,128),required(input.text,4000)];
  case 'brief':return ['brief','--json'];
  default:throw new MexRuntimeError('INVALID_REQUEST','Unsupported MEX operation');
 }
}
/** Executes only the pinned engine. Caller supplies an isolated repository and private state directory. */
export class MexRuntime {
 constructor(readonly packageDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'../runtime/mex/node_modules/mex-agent')){}
 async run(repository:string,stateDirectory:string,input:MexRequest,options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<MexResult>{
  const args=argumentsFor(input),root=await realpath(repository);
  const state=resolve(stateDirectory);await mkdir(state,{recursive:true,mode:0o700});
  if(!(await stat(root)).isDirectory())throw new MexRuntimeError('INVALID_REQUEST','Repository directory required');
  let cli:string;
  try{const metadata=JSON.parse(await readFile(join(this.packageDirectory,'package.json'),'utf8'));if(metadata.name!=='mex-agent'||metadata.version!==MEX_VERSION)throw Error('Version mismatch');cli=await realpath(join(this.packageDirectory,'dist/cli.js'));}
  catch{throw new MexRuntimeError('ENGINE_UNAVAILABLE','Install the pinned Pensieve MEX runtime before running repository jobs');}
  const timeout=options.timeoutMs??120000;if(!Number.isInteger(timeout)||timeout<1||timeout>840000)throw new MexRuntimeError('INVALID_REQUEST','Invalid job deadline');
  if(options.signal?.aborted)throw new MexRuntimeError('CANCELLED','Repository operation cancelled');
  // Deliberate allowlist: no cloud credentials, agent config, NODE_OPTIONS, or inherited compiler hooks.
  const env:NodeJS.ProcessEnv={PATH:process.env.PATH??'/usr/bin:/bin',HOME:state,USERPROFILE:state,TMPDIR:state,TEMP:state,TMP:state,MEX_HOME:join(state,'mex'),MEX_TELEMETRY:'0',DO_NOT_TRACK:'1',MEX_OFFLINE:'1',MEX_BACKGROUND:'0',MEX_INSTALL_AUTO:'0',CI:'1',NO_COLOR:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.hooksPath',GIT_CONFIG_VALUE_0:'/dev/null'};
  return new Promise<MexResult>((accept,reject)=>{
   const child=spawn(process.execPath,[cli,...args],{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
   const buffers:Buffer[]=[];let bytes=0,error:MexRuntimeError|undefined;let killTimer:ReturnType<typeof setTimeout>|undefined;
   const kill=(signal:NodeJS.Signals)=>{try{if(process.platform==='win32')child.kill(signal);else if(child.pid)process.kill(-child.pid,signal);}catch{/* Already exited. */}};
   const stop=(reason:MexRuntimeError)=>{if(error)return;error=reason;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);killTimer.unref();};
   const cancel=()=>stop(new MexRuntimeError('CANCELLED','Repository operation cancelled'));
   const timer=setTimeout(()=>stop(new MexRuntimeError('TIMEOUT','Repository operation exceeded its deadline')),timeout);
   options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
   const collect=(chunk:Buffer,stdout:boolean)=>{bytes+=chunk.length;if(bytes>8*1024*1024)stop(new MexRuntimeError('OUTPUT_LIMIT','Repository operation exceeded its output limit'));else if(stdout)buffers.push(chunk);};
   child.stdout.on('data',chunk=>collect(chunk,true));child.stderr.on('data',chunk=>collect(chunk,false));
   child.on('error',()=>stop(new MexRuntimeError('ENGINE_UNAVAILABLE','Could not start the MEX engine')));
   child.on('close',code=>{
    clearTimeout(timer);if(killTimer)clearTimeout(killTimer);options.signal?.removeEventListener('abort',cancel);
    if(error){reject(error);return;}
    const output=Buffer.concat(buffers).toString('utf8').trim();let records:unknown[];
    try{try{records=[JSON.parse(output)];}catch{records=output.split('\n').filter(Boolean).map(line=>JSON.parse(line));}if(!records.length)throw Error('Empty output');}
    catch{reject(new MexRuntimeError('ENGINE_FAILED','MEX returned an invalid structured result'));return;}
    // A check can return findings with exit 1; never turn those into a successful clean check.
    if(code!==0&&!(input.operation==='check'&&code===1)){reject(new MexRuntimeError('ENGINE_FAILED','MEX could not complete the repository operation'));return;}
    accept({engine:MEX_VERSION,operation:input.operation,records,exitCode:code??1});
   });
  });
 }
}
