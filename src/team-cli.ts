import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {TeamClient,ContributionQueue,type CaptureContext} from './team-client.js';
import {Store} from './store.js';
import {makeMemory,readSession} from './sessions.js';
import {parsePolicyToml,resolvePolicy,type CapturePolicy} from './policy.js';
import {readBundle,writeBundle} from './sharing.js';
export interface TeamOptions {home?:string;pool?:string;project?:string;session?:string;config?:string;ids?:string;output?:string;limit?:string;raw?:boolean;citation?:string;ticket?:string;interval?:string}
export const teamCommands=['connect','team-pools','team-create','save','recall','sync','team-import','team-export','team-index','watch-session'];
const need=(v:string|undefined,n:string)=>{if(!v)throw Error(`${n} required`);return v;};
export async function connectedClient(home:string){
  let saved:{url?:string;token?:string}={};
  try{saved=JSON.parse(await readFile(join(home,'team-connection.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Invalid saved team connection');}
  if(process.env.PENSIEVE_TEAM_URL && !process.env.PENSIEVE_TEAM_TOKEN && saved.url && new URL(process.env.PENSIEVE_TEAM_URL).origin!==new URL(saved.url).origin) throw Error('Changed server requires its own PENSIEVE_TEAM_TOKEN');
  return new TeamClient(need(process.env.PENSIEVE_TEAM_URL??saved.url,'PENSIEVE_TEAM_URL'),need(process.env.PENSIEVE_TEAM_TOKEN??saved.token,'PENSIEVE_TEAM_TOKEN'));
}
export async function localPolicy(options:TeamOptions):Promise<CapturePolicy>{
  if(options.config)return resolvePolicy(parsePolicyToml(await readFile(options.config,'utf8')));
  return options.pool?{destination:'shared',pool:options.pool,autoSave:false}:{destination:'private',autoSave:false};
}
export async function runTeamCommand(command:string,arg:string|undefined,extra:string|undefined,options:TeamOptions){
  const home=options.home??join(homedir(),'.pensieve');
  const out=(value:unknown)=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  const context:CaptureContext={repository:options.project?resolve(options.project):undefined,conversation:options.session,...(options.config?{policyFile:resolve(options.config)}:{})};
  if(command==='connect'){
    const client=new TeamClient(need(arg??process.env.PENSIEVE_TEAM_URL,'Server URL'),need(process.env.PENSIEVE_TEAM_TOKEN,'PENSIEVE_TEAM_TOKEN'));
    const user=await client.me();await mkdir(home,{recursive:true,mode:0o700});const file=join(home,'team-connection.json');
    await writeFile(file,JSON.stringify({url:client.url,token:process.env.PENSIEVE_TEAM_TOKEN})+'\n',{mode:0o600});await chmod(file,0o600);out({connected:client.url,user});return;
  }
  const save=async(text:string,sourceMemory?:ReturnType<typeof makeMemory>)=>{
    const captureContext={...context,...(sourceMemory?{conversation:sourceMemory.session,automatic:true}:{})};
    const policy=await localPolicy(options);
    if(policy.destination==='off'){out({saved:false,reason:'Capture disabled'});return;}
    const memory=sourceMemory??{...makeMemory({text,source:'manual',session:options.session??'capture',role:'user',timestamp:new Date().toISOString(),locator:'supplied-distillation',project:context.repository??''}),kind:options.raw?'raw' as const:'distilled' as const,...(options.citation?{citations:[options.citation]}:{}),...(options.ticket?{ticket:options.ticket}:{})};
    if(policy.destination==='private'){const store=new Store(join(home,'memory.sqlite'));try{out({saved:store.add([memory]),destination:'private'});}finally{store.close();}return;}
    const client=await connectedClient(home);const queue=new ContributionQueue(home,client.binding);
    try{queue.enqueue(memory,policy,captureContext);out(await queue.flush((pool,memories,ctx,provenance)=>client.putMemories(pool,memories,provenance,ctx),async(pool,ctx)=>{
      const local=await localPolicy({...options,config:ctx.policyFile??options.config});if(local.destination!=='shared'||local.pool!==pool)return local;
      const remote=await client.policy(pool,ctx);return Object.keys(remote.policies).length?remote.effective:local;
    }));}finally{queue.close();}
  };
  if(command==='team-import'){
    const policy=await localPolicy(options);
    if(policy.destination==='off'){out({imported:0,reason:'Capture disabled'});return;}
    const bundle=await readBundle(need(arg,'Bundle file'));
    if(policy.destination==='private'){
      const local=new Store(join(home,'memory.sqlite'));
      try{out({imported:local.add(bundle.memories,bundle.provenance),destination:'private'});}finally{local.close();}
      return;
    }
    const client=await connectedClient(home);const queue=new ContributionQueue(home,client.binding);
    try{
      for(const memory of bundle.memories)queue.enqueue(memory,policy,context,bundle.provenance?.filter(origin=>origin.memoryId===memory.id));
      out(await queue.flush((pool,memories,ctx,provenance)=>client.putMemories(pool,memories,provenance,ctx),async(pool,ctx)=>{
        const local=await localPolicy({...options,config:ctx.policyFile??options.config});if(local.destination!=='shared'||local.pool!==pool)return local;
        const remote=await client.policy(pool,ctx);return Object.keys(remote.policies).length?remote.effective:local;
      }));
    }finally{queue.close();}
    return;
  }
  if(command==='save'){await save(need(arg,'Memory text'));return;}
  if(command==='watch-session'){
    if(arg!=='codex'&&arg!=='claude')throw Error('Source must be codex or claude');
    const project=resolve(need(options.project,'--project'));const path=need(extra,'Session file');
    const interval=Number(options.interval??2000);if(!Number.isInteger(interval)||interval<1000||interval>3600000)throw Error('Interval must be 1000..3600000 ms');
    const seen=new Set<string>();let running=false;
    const ingest=async()=>{if(running)return;running=true;try{const policy=await localPolicy(options);if(!policy.autoSave||policy.destination==='off')return;const parsed=await readSession(path,arg);for(const m of parsed.memories){if(resolve(m.project||'/')!==project||seen.has(m.id))continue;await save(m.text,{...m,kind:'raw'});seen.add(m.id);}
      if(policy.destination==='shared'){
        const client=await connectedClient(home);const queue=new ContributionQueue(home,client.binding);
        try{const result=await queue.flush((pool,memories,ctx,provenance)=>client.putMemories(pool,memories,provenance,ctx),async(pool,ctx)=>{
          const current=await localPolicy({...options,config:ctx.policyFile??options.config});if(current.destination!=='shared'||current.pool!==pool)return current;
          const remote=await client.policy(pool,ctx);return Object.keys(remote.policies).length?remote.effective:current;
        });if(result.sent||result.pending)out(result);}finally{queue.close();}
      }
    }finally{running=false;}};
    await ingest();const timer=setInterval(()=>{void ingest().catch(()=>process.stderr.write('Session capture failed; will retry\n'));},interval);
    const stop=()=>{clearInterval(timer);process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);return;
  }
  const client=await connectedClient(home);
  if(command==='team-pools'){out(await client.pools());return;}
  if(command==='team-create'){if(extra!==undefined&&!['private','shared'].includes(extra))throw Error('Visibility must be private or shared');out(await client.createPool(need(arg,'Pool name'),extra==='shared'?'shared':'private'));return;}
  const pool=need(options.pool,'--pool');
  if(command==='team-index'){out(await client.index(pool));return;}
  if(command==='recall'){out(await client.search(pool,need(arg,'Query'),Number(options.limit??8)));return;}
  if(command==='team-export'){const ids=need(options.ids,'--ids').split(',');const bundle=await client.export(pool,ids);await writeBundle(need(options.output??arg,'Output path'),bundle);out({exported:bundle.memories.length});return;}
  if(command==='sync'){
    const queue=new ContributionQueue(home,client.binding);
    try{out(await queue.flush((p,memories,ctx,provenance)=>client.putMemories(p,memories,provenance,ctx),async(p,ctx)=>{
      const local=await localPolicy({...options,config:ctx.policyFile??options.config});if(local.destination!=='shared'||local.pool!==p)return local;
      const remote=await client.policy(p,ctx);return Object.keys(remote.policies).length?remote.effective:local;
    }));}finally{queue.close();}
    const memories=await client.memories(pool);if(!memories.length){out({pulled:0});return;}const bundle=await client.export(pool,memories.map(m=>m.memory.id));
    const store=new Store(join(home,'memory.sqlite'));try{out({pulled:store.add(bundle.memories,bundle.provenance)});}finally{store.close();}return;
  }
  throw Error('Unknown team command');
}
