import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {validateCapturePolicy,type CapturePolicy} from './policy.js';
import {validateMemoryRecord,validateProvenance} from './memory-record.js';
import type {Memory,Bundle,Hit} from './types.js';
import type {TeamPool,TeamMemory,TeamUser} from './team-store.js';
export interface CaptureContext {repository?:string;conversation?:string;policyFile?:string;automatic?:boolean}
export class TeamClient {
  readonly url:string;
  readonly binding:string;
  constructor(url:string,private readonly token:string) {
    const u=new URL(url);
    if(u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw Error('HTTPS required except loopback');
    if(u.username||u.password||u.search||u.hash||u.pathname!=='/') throw Error('Use a server origin without credentials or path');
    if(!token||token.length>1024) throw Error('Personal token required');
    this.url=u.origin;this.binding=createHash('sha256').update(this.url+'\0'+token).digest('hex');
  }
  async request<T>(path:string,body?:unknown):Promise<T> {
    let response:Response;
    const accessId=process.env.PENSIEVE_CF_ACCESS_CLIENT_ID,accessSecret=process.env.PENSIEVE_CF_ACCESS_CLIENT_SECRET;
    if(!!accessId!==!!accessSecret)throw Error('Both Cloudflare service credentials required');
    if(accessId&&process.env.PENSIEVE_CF_ACCESS_ORIGIN!==this.url)throw Error('Cloudflare service credentials require a matching PENSIEVE_CF_ACCESS_ORIGIN');
    const accessHeaders:Record<string,string>=accessId&&accessSecret?{'CF-Access-Client-Id':accessId,'CF-Access-Client-Secret':accessSecret}:{};
    try {response=await fetch(this.url+'/api/team/'+path,{method:body===undefined?'GET':'POST',headers:{...accessHeaders,Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch {throw Error('Team service unavailable; queued contributions remain local');}
    if(!response.ok) throw Error(`Team request rejected (${response.status})`);
    return await response.json() as T;
  }
  async me(){return (await this.request<{user:TeamUser}>('me')).user;}
  async pools(){return (await this.request<{pools:TeamPool[]}>('pools')).pools;}
  async createPool(name:string,visibility:'private'|'shared'){return (await this.request<{pool:TeamPool}>('pools',{name,visibility})).pool;}
  private path(pool:string,action:string){return `pools/${encodeURIComponent(pool)}/${action}`;}
  putMemories(pool:string,memories:Memory[],provenance?:Bundle['provenance'],context:CaptureContext={}){return this.request<{imported:number;ids:string[]}>(this.path(pool,'memories'),{memories,provenance,repository:context.repository,conversation:context.conversation});}
  async memories(pool:string){return (await this.request<{memories:TeamMemory[]}>(this.path(pool,'memories'))).memories;}
  export(pool:string,ids:string[]){return this.request<Bundle>(this.path(pool,'export'),{ids});}
  index(pool:string){return this.request<{indexed:number}>(this.path(pool,'index'),{});}
  async search(pool:string,query:string,limit=8){return (await this.request<{hits:Hit[]}>(this.path(pool,'search'),{query,limit})).hits;}
  policy(pool:string,context:CaptureContext={}){const q=new URLSearchParams();if(context.repository)q.set('repository',context.repository);if(context.conversation)q.set('conversation',context.conversation);return this.request<{policies:Record<string,CapturePolicy>;effective:CapturePolicy}>(this.path(pool,'policy')+'?'+q);}
  setPolicy(pool:string,scope:string,key:string,policy:CapturePolicy){return this.request(this.path(pool,'policy'),{scope,key,policy});}
  share(pool:string,input:Record<string,unknown>){return this.request(this.path(pool,'shares'),input);}
}
interface QueueRow {id:string;pool:string;memory:string;context:string;binding:string;provenance:string}
export class ContributionQueue {
  private db:DatabaseSync;
  constructor(home:string,private readonly binding='local-default'){
    mkdirSync(home,{recursive:true,mode:0o700});const path=join(home,'outbox.sqlite');this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`CREATE TABLE IF NOT EXISTS contributions(id TEXT PRIMARY KEY,pool TEXT NOT NULL,memory TEXT NOT NULL,context TEXT NOT NULL,binding TEXT NOT NULL,provenance TEXT NOT NULL DEFAULT '[]')`);
    const columns=this.db.prepare('PRAGMA table_info(contributions)').all();if(!columns.some(c=>c.name==='provenance'))this.db.exec(`ALTER TABLE contributions ADD COLUMN provenance TEXT NOT NULL DEFAULT '[]'`);
  }
  close(){this.db.close();}
  enqueue(memory:Memory,policy:CapturePolicy,context:CaptureContext={},provenance:Bundle['provenance']=[]){
    const p=validateCapturePolicy(policy);if(p.destination!=='shared')return false;validateMemoryRecord(memory);validateProvenance(provenance,new Set([memory.id]));
    const id=createHash('sha256').update(JSON.stringify([this.binding,p.pool,memory.id,context])).digest('hex');
    const existing=this.db.prepare('SELECT memory,provenance FROM contributions WHERE id=?').get(id);
    if(existing && (existing.memory!==JSON.stringify(memory)||existing.provenance!==JSON.stringify(provenance)))throw Error('Conflicting queued memory');
    return this.db.prepare('INSERT OR IGNORE INTO contributions VALUES (?,?,?,?,?,?)').run(id,p.pool!,JSON.stringify(memory),JSON.stringify(context),this.binding,JSON.stringify(provenance)).changes===1;
  }
  async flush(send:(pool:string,memories:Memory[],context:CaptureContext,provenance:Bundle['provenance'])=>Promise<unknown>,currentPolicy:(pool:string,context:CaptureContext)=>Promise<CapturePolicy>){
    let sent=0,held=0;
    const rows=this.db.prepare('SELECT * FROM contributions ORDER BY rowid').all() as unknown as QueueRow[];
    for(const row of rows){
      if(row.binding!==this.binding){held++;continue;}
      const context=JSON.parse(row.context) as CaptureContext;
      try {
        if(!currentPolicy){held++;continue;}
        {const p=validateCapturePolicy(await currentPolicy(row.pool,context));if(p.destination!=='shared'||p.pool!==row.pool||(context.automatic&&!p.autoSave)){held++;continue;}}
        await send(row.pool,[JSON.parse(row.memory) as Memory],context,JSON.parse(row.provenance) as Bundle['provenance']);
        this.db.prepare('DELETE FROM contributions WHERE id=?').run(row.id);sent++;
      }catch {held++;}
    }
    return {sent,pending:Number(this.db.prepare('SELECT COUNT(*) AS n FROM contributions').get()!.n),held};
  }
}
