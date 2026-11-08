import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction,type PgQuery} from './postgres.js';
import {TeamAccessError,type TeamUser,type TeamPool,type TeamMember,type TeamMemory,type TeamShare} from './team-store.js';
import {validateMemoryRecord,validateProvenance} from './memory-record.js';
import {validateCapturePolicy,type PolicyLayers} from './policy.js';
import {validateVector} from './embeddings.js';
import {validateShare,type ShareInput,type Snapshot} from './executive.js';
import type {Bundle,EmbeddingProvider,Hit,Memory,MemoryProvenance} from './types.js';
import type {MemoryPage,SharePage,TeamRepository} from './repositories.js';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const canonical=(v:unknown):string=>JSON.stringify(normalize(v));
function normalize(v:unknown):unknown{return Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,normalize(x)])):v;}
function bounded(value:unknown,name:string,max=512):asserts value is string{if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Invalid ${name}`);}
const memoryRow=(r:{body:string;contributor:string;created:string}):TeamMemory=>({memory:JSON.parse(r.body),contributorId:r.contributor,createdAt:r.created});
/** One pool is shared by every hosted repository; scoped copies borrow a transaction client. */
export class PgTeamStore implements TeamRepository {
 private constructor(readonly pool:Pool,readonly sourceServer:string,private readonly client?:PoolClient){}
 static async open(pool:Pool):Promise<PgTeamStore>{
  await pool.query('INSERT INTO team_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',['issuer',randomUUID()]);
  const result=await pool.query<{value:string}>('SELECT value FROM team_meta WHERE key=$1',['issuer']);
  return new PgTeamStore(pool,result.rows[0].value);
 }
 private get q():PgQuery{return this.client??this.pool;}
 private async tx<T>(action:(store:PgTeamStore)=>Promise<T>):Promise<T>{return this.client?action(this):transaction(this.pool,client=>action(new PgTeamStore(this.pool,this.sourceServer,client)));}
 async close():Promise<void>{/* Pool lifecycle belongs to service composition root. */}
 async createUser(name:string){bounded(name,'user name',160);const user={id:randomUUID(),name:name.trim()},token=randomBytes(32).toString('base64url');await this.q.query('INSERT INTO team_users(id,name,token) VALUES($1,$2,$3)',[user.id,user.name,digest(token)]);return {user,token};}
 async accessUser(issuer:string,subject:string,email:string):Promise<TeamUser>{
  bounded(issuer,'issuer');bounded(subject,'subject');bounded(email,'email',160);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new TeamAccessError(401,'Verified email required');
  return this.tx(async s=>{await s.q.query('SELECT pg_advisory_xact_lock(hashtext($1))',[JSON.stringify([issuer,subject])]);
   const prior=await s.q.query<{actor:string}>('SELECT actor FROM team_access_identities WHERE issuer=$1 AND subject=$2',[issuer,subject]);
   if(prior.rows[0])return s.getUser(prior.rows[0].actor);
   const {user}=await s.createUser(email);await s.q.query('INSERT INTO team_access_identities VALUES($1,$2,$3)',[issuer,subject,user.id]);return user;
  });
 }
 async getUser(id:string):Promise<TeamUser>{const result=await this.q.query<TeamUser>('SELECT id,name FROM team_users WHERE id=$1 AND active=1'+(this.client?' FOR SHARE':''),[id]);if(!result.rows[0])throw new TeamAccessError(401,'Unauthorized identity');return result.rows[0];}
 async authenticate(token:string):Promise<TeamUser>{if(typeof token!=='string'||token.length>512)throw new TeamAccessError(401,'Unauthorized authentication');const r=await this.q.query<{id:string}>('SELECT id FROM team_users WHERE token=$1 AND active=1',[digest(token)]);if(!r.rows[0])throw new TeamAccessError(401,'Unauthorized authentication');return this.getUser(r.rows[0].id);}
 async rotatePersonalToken(actor:string):Promise<{token:string}>{return this.tx(async s=>{const user=await s.q.query('SELECT id FROM team_users WHERE id=$1 AND active=1 FOR UPDATE',[actor]);if(!user.rows[0])throw new TeamAccessError(401,'Unauthorized identity');const token=randomBytes(32).toString('base64url');await s.q.query('UPDATE team_users SET token=$2 WHERE id=$1',[actor,digest(token)]);return {token};});}
 async revokeUser(id:string){await this.q.query('UPDATE team_users SET active=0 WHERE id=$1',[id]);}
 async createPool(actor:string,name:string,visibility:TeamPool['visibility']):Promise<TeamPool>{
  bounded(name,'pool name',160);if(!['private','shared'].includes(visibility))throw Error('Invalid pool visibility');
  return this.tx(async s=>{await s.getUser(actor);const p:TeamPool={id:randomUUID(),name:name.trim(),visibility,role:'owner'};await s.q.query('INSERT INTO team_pools VALUES($1,$2,$3)',[p.id,p.name,p.visibility]);await s.q.query('INSERT INTO team_members VALUES($1,$2,$3)',[p.id,actor,'owner']);return p;});
 }
 async listPools(actor:string):Promise<TeamPool[]>{await this.getUser(actor);return (await this.q.query<TeamPool>('SELECT p.id,p.name,p.visibility,m.role FROM team_pools p JOIN team_members m ON m.pool=p.id WHERE m.actor=$1 ORDER BY p.id',[actor])).rows;}
 async getPool(actor:string,pool:string):Promise<TeamPool>{await this.getUser(actor);const r=await this.q.query<TeamPool>('SELECT p.id,p.name,p.visibility,m.role FROM team_pools p JOIN team_members m ON m.pool=p.id WHERE m.actor=$1 AND p.id=$2'+(this.client?' FOR SHARE OF p,m':''),[actor,pool]);if(!r.rows[0])throw new TeamAccessError(404,'Pool unavailable');return r.rows[0];}
 private async writable(actor:string,pool:string){const p=await this.getPool(actor,pool);if(p.role==='reader')throw new TeamAccessError(403,'Writer authorization required');return p;}
 async grantMember(actor:string,pool:string,userId:string,role:'reader'|'writer'){
  return this.tx(async s=>{const p=await s.getPool(actor,pool);if(p.role!=='owner')throw new TeamAccessError(403,'Pool owner required');if(p.visibility==='private')throw new TeamAccessError(403,'Private pools cannot grant membership');if(!['reader','writer'].includes(role))throw Error('Invalid membership role');await s.getUser(userId);
   const r=await s.q.query<{role:string}>('SELECT role FROM team_members WHERE pool=$1 AND actor=$2',[pool,userId]);if(r.rows[0]?.role==='owner')throw new TeamAccessError(403,'Cannot replace pool owner');
   await s.q.query('INSERT INTO team_members VALUES($1,$2,$3) ON CONFLICT(pool,actor) DO UPDATE SET role=excluded.role',[pool,userId,role]);
  });
 }
 async listMembers(actor:string,pool:string):Promise<TeamMember[]>{await this.getPool(actor,pool);return (await this.q.query<TeamMember>('SELECT u.id AS "userId",u.name,m.role FROM team_members m JOIN team_users u ON u.id=m.actor WHERE m.pool=$1 AND u.active=1',[pool])).rows;}
 async putMemory(actor:string,pool:string,memory:Memory){const r=await this.putMemories(actor,pool,[memory]);return {id:memory.id,created:r.imported===1};}
 async putMemories(actor:string,pool:string,memories:Memory[],provenance?:MemoryProvenance[]){
  if(!Array.isArray(memories)||!memories.length||memories.length>10000)throw Error('Invalid memory batch');memories.forEach(validateMemoryRecord);const ids=[...new Set(memories.map(m=>m.id))];const origins=provenance===undefined?[]:validateProvenance(provenance,new Set(ids));
  const unique=new Map<string,string>();for(const m of memories){const body=canonical(m);if(unique.has(m.id)&&unique.get(m.id)!==body)throw Error(`Conflicting content for memory ${m.id}`);unique.set(m.id,body);}
  return this.tx(async s=>{await s.writable(actor,pool);let imported=0;const entries=[...unique];const created=new Date().toISOString();
   for(let offset=0;offset<entries.length;offset+=250){const batch=entries.slice(offset,offset+250),batchIds=batch.map(([id])=>id);
    imported+=(await s.q.query('INSERT INTO team_memories(pool,id,body,contributor,created) SELECT $1,x.id,x.body,$4,$5 FROM unnest($2::text[],$3::text[]) AS x(id,body) ON CONFLICT(pool,id) DO NOTHING',[pool,batchIds,batch.map(([,body])=>body),actor,created])).rowCount??0;
    const existing=await s.q.query<{id:string;body:string}>('SELECT id,body FROM team_memories WHERE pool=$1 AND id=ANY($2::text[])',[pool,batchIds]);for(const row of existing.rows)if(canonical(JSON.parse(row.body))!==unique.get(row.id))throw Error(`Conflicting content for memory ${row.id}`);
   }
   for(let offset=0;offset<origins.length;offset+=250){const batch=origins.slice(offset,offset+250);await s.q.query('INSERT INTO team_origins(pool,id,origin,body) SELECT $1,x.id,x.origin,x.body FROM unnest($2::text[],$3::text[],$4::text[]) AS x(id,origin,body) ON CONFLICT DO NOTHING',[pool,batch.map(p=>p.memoryId),batch.map(p=>digest(canonical([p.sourceServer,p.poolId,p.memoryId,p.contributorId,p.createdAt]))),batch.map(p=>canonical({...p,verification:'unverified-import'}))]);}return {imported,ids};
  });
 }

 async listMemories(actor:string,pool:string):Promise<TeamMemory[]>{await this.getPool(actor,pool);return (await this.q.query<{body:string;contributor:string;created:string}>('SELECT body,contributor,created FROM team_memories WHERE pool=$1 ORDER BY id',[pool])).rows.map(memoryRow);}
 async listMemoryPage(actor:string,pool:string,options:{limit?:number;cursor?:string}={}):Promise<MemoryPage>{
  await this.getPool(actor,pool);const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Page limit must be 1..100');
  if(options.cursor!==undefined&&!/^[a-f0-9]{64}$/.test(options.cursor))throw Error('Invalid memory cursor');
  const rows=(await this.q.query<{id:string;body:string;contributor:string;created:string}>('SELECT id,body,contributor,created FROM team_memories WHERE pool=$1 AND id>$2 ORDER BY id LIMIT $3',[pool,options.cursor??'',limit+1])).rows;
  return {memories:rows.slice(0,limit).map(memoryRow),...(rows.length>limit?{nextCursor:rows[limit-1].id}:{})};
 }
 async getMemories(actor:string,pool:string,ids:string[]):Promise<Memory[]>{
  await this.getPool(actor,pool);if(!Array.isArray(ids)||ids.length>10000||ids.some(x=>typeof x!=='string'))throw Error('Invalid memory selection');
  const unique=[...new Set(ids)];const rows=(await this.q.query<{id:string;body:string}>('SELECT id,body FROM team_memories WHERE pool=$1 AND id=ANY($2::text[])',[pool,unique])).rows;const map=new Map(rows.map(r=>[r.id,r.body]));return unique.map(id=>{const body=map.get(id);if(!body)throw new TeamAccessError(404,'Memory unavailable');return JSON.parse(body) as Memory;});
 }
 async exportBundle(actor:string,pool:string,ids:string[]):Promise<Bundle>{
  if(!ids?.length)throw Error('Select at least one memory explicitly');const memories=await this.getMemories(actor,pool,ids);const provenance:MemoryProvenance[]=[];
  const rows=(await this.q.query<{id:string;contributor:string;created:string;name:string}>('SELECT m.id,m.contributor,m.created,u.name FROM team_memories m JOIN team_users u ON u.id=m.contributor WHERE m.pool=$1 AND m.id=ANY($2::text[])',[pool,ids])).rows;
  const origins=(await this.q.query<{body:string}>('SELECT body FROM team_origins WHERE pool=$1 AND id=ANY($2::text[])',[pool,ids])).rows;
  for(const r of rows)provenance.push({memoryId:r.id,contributorId:r.contributor,contributorName:r.name,poolId:pool,createdAt:r.created,sourceServer:this.sourceServer,verification:'source-server'});
  provenance.push(...origins.map(r=>JSON.parse(r.body) as MemoryProvenance));return {format:'pensieve/v1',createdAt:new Date().toISOString(),memories,provenance};
 }
 async recordShare(actor:string,pool:string,shareId:string,ids:string[]){return this.tx(async s=>{await s.writable(actor,pool);bounded(shareId,'share ID');if(!ids?.length)throw Error('Select memories to share');await s.getMemories(actor,pool,ids);await s.q.query('INSERT INTO team_shares VALUES($1,$2,$3,$4)',[shareId,pool,actor,JSON.stringify([...new Set(ids)])]);});}
 async createShare(actor:string,pool:string,input:ShareInput & {ids:string[]}):Promise<Snapshot>{
  return this.tx(async s=>{await s.writable(actor,pool);const bundle=await s.exportBundle(actor,pool,input.ids);const validated=validateShare({...input,bundle});const now=Date.now();const snapshot:Snapshot={...validated,id:randomBytes(16).toString('hex'),createdAt:now,expiresAt:now+validated.days*86400000,revoked:false};
   await s.q.query('INSERT INTO shares(id,body) VALUES($1,$2)',[snapshot.id,JSON.stringify(snapshot)]);await s.recordShare(actor,pool,snapshot.id,input.ids);return snapshot;
  });
 }
 async listShares(actor:string,pool:string):Promise<TeamShare[]>{const p=await this.writable(actor,pool);return (await this.q.query<{id:string;pool:string;creator:string;ids:string}>('SELECT id,pool,creator,ids FROM team_shares WHERE pool=$1 AND ($2::boolean OR creator=$3) ORDER BY id',[pool,p.role==='owner',actor])).rows.map(r=>({shareId:r.id,poolId:r.pool,creatorId:r.creator,ids:JSON.parse(r.ids)}));}
 async listSharePage(actor:string,pool:string,options:{limit?:number;cursor?:string}={}):Promise<SharePage>{
  await this.writable(actor,pool);const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Page limit must be 1..100');if(options.cursor!==undefined&&!/^[a-f0-9]{32}$/.test(options.cursor))throw Error('Invalid share cursor');
  const rows=(await this.q.query<SharePage['shares'][number]>(`SELECT s.id,s.body::jsonb->>'title' AS title,s.body::jsonb->'recipients' AS recipients,(s.body::jsonb->>'expiresAt')::double precision AS "expiresAt",s.revoked<>0 AS revoked,jsonb_array_length(s.body::jsonb->'bundle'->'memories') AS count FROM team_shares t JOIN shares s ON s.id=t.id JOIN team_members m ON m.pool=t.pool AND m.actor=$1 JOIN team_users u ON u.id=m.actor AND u.active=1 WHERE t.pool=$2 AND (m.role='owner' OR (m.role='writer' AND t.creator=$1)) AND t.id>$3 ORDER BY t.id LIMIT $4`,[actor,pool,options.cursor??'',limit+1])).rows;
  return {shares:rows.slice(0,limit),...(rows.length>limit?{nextCursor:rows[limit-1].id}:{})};
 }
 async authorizeShareRevocation(actor:string,pool:string,shareId:string){const p=await this.writable(actor,pool);const r=await this.q.query<{creator:string}>('SELECT creator FROM team_shares WHERE id=$1 AND pool=$2',[shareId,pool]);if(!r.rows[0]||(p.role!=='owner'&&r.rows[0].creator!==actor))throw new TeamAccessError(404,'Share unavailable');}
 async setPolicy(actor:string,pool:string,scope:keyof PolicyLayers,key:string,policy:unknown){return this.tx(async s=>{const p=await s.writable(actor,pool);if(scope==='team'&&p.role!=='owner')throw new TeamAccessError(403,'Pool owner required for team policy');if(!['team','repository','conversation'].includes(scope))throw Error('Invalid policy scope');if(scope==='team'){if(key!=='')throw Error('Team policy uses empty context');}else bounded(key,'policy context',4096);const validated=validateCapturePolicy(policy);if(validated.destination==='shared'){const target=await s.writable(actor,validated.pool!);if(target.visibility!=='shared')throw Error('Shared policy requires a shared pool');}await s.q.query('INSERT INTO team_policies VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor,pool,scope,context) DO UPDATE SET body=excluded.body',[actor,pool,scope,key,JSON.stringify(validated)]);});}
 async getPolicies(actor:string,pool:string,repository?:string,conversation?:string):Promise<PolicyLayers>{await this.getPool(actor,pool);const result:PolicyLayers={};for(const [scope,key] of [['team',''],['repository',repository],['conversation',conversation]] as const)if(key!==undefined){const r=await this.q.query<{body:string}>("SELECT body FROM team_policies WHERE actor=CASE WHEN $3='team' THEN (SELECT actor FROM team_members WHERE pool=$2 AND role='owner' LIMIT 1) ELSE $1 END AND pool=$2 AND scope=$3 AND context=$4",[actor,pool,scope,key]);if(r.rows[0])result[scope]=validateCapturePolicy(JSON.parse(r.rows[0].body));}return result;}
 async index(actor:string,pool:string,provider:EmbeddingProvider):Promise<number>{
  await this.writable(actor,pool);bounded(provider.identity,'model identity');
  // A session-local staging table bounds application memory without holding a transaction over network calls.
  const client=await this.pool.connect(),table=`pensieve_index_${randomBytes(8).toString('hex')}`;
  const scoped=new PgTeamStore(this.pool,this.sourceServer,client);let begun=false;
  try{await client.query(`CREATE TEMP TABLE ${table}(id TEXT PRIMARY KEY,vector vector NOT NULL)`);let cursor='',dimension:number|undefined;
   for(;;){await scoped.writable(actor,pool);const rows=(await client.query<{id:string;body:string}>('SELECT m.id,m.body FROM team_memories m WHERE m.pool=$1 AND m.id>$4 AND NOT EXISTS(SELECT 1 FROM team_vectors v WHERE v.pool=m.pool AND v.id=m.id AND v.model=$2 AND v.backend=$3) ORDER BY m.id LIMIT 16',[pool,provider.identity,'local',cursor])).rows;if(!rows.length)break;
    const batch=rows.map(r=>JSON.parse(r.body) as Memory),vectors=await provider.embed(batch.map(m=>m.text),'document');if(!Array.isArray(vectors)||vectors.length!==batch.length)throw Error('Embedding response count mismatch');
    for(const v of vectors){validateVector(v);dimension??=v.length;if(v.length!==dimension)throw Error('Embedding dimension changed');}
    await client.query(`INSERT INTO ${table}(id,vector) SELECT x.id,x.vector::vector FROM unnest($1::text[],$2::text[]) AS x(id,vector)`,[rows.map(r=>r.id),vectors.map(v=>JSON.stringify(v))]);cursor=rows[rows.length-1].id;
   }
   if(dimension===undefined)return 0;
   await client.query('BEGIN');begun=true;await scoped.writable(actor,pool);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([pool,provider.identity,'index'])]);
   const prior=await client.query<{dimensions:number}>('SELECT vector_dims(vector) AS dimensions FROM team_vectors WHERE pool=$1 AND model=$2 AND backend=$3 LIMIT 1',[pool,provider.identity,'local']);if(prior.rows[0]&&prior.rows[0].dimensions!==dimension)throw Error('Embedding dimension changed');
   const result=await client.query(`INSERT INTO team_vectors(pool,id,model,backend,vector) SELECT $1,id,$2,$3,vector FROM ${table} ON CONFLICT DO NOTHING`,[pool,provider.identity,'local']);await client.query('COMMIT');begun=false;return result.rowCount??0;
  }catch(error){if(begun)await client.query('ROLLBACK');throw error;}finally{try{await client.query(`DROP TABLE IF EXISTS ${table}`);}finally{client.release();}}
 }
 async search(actor:string,pool:string,query:string,provider:EmbeddingProvider,limit=8):Promise<Hit[]>{
  await this.getPool(actor,pool);bounded(query,'search query',10000);bounded(provider.identity,'model identity');if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Limit must be 1..100');const vectors=await provider.embed([query],'query');if(vectors.length!==1)throw Error('Embedding response count mismatch');validateVector(vectors[0]);
  const dimensions=await this.q.query<{dimensions:number}>('SELECT DISTINCT vector_dims(vector) AS dimensions FROM team_vectors WHERE pool=$1 AND model=$2 AND backend=$3',[pool,provider.identity,'local']);if(!dimensions.rows.length)throw Error('No indexed memories for this model');if(dimensions.rows.some(r=>r.dimensions!==vectors[0].length))throw Error('Embedding dimension mismatch');
  // Membership and active identity are part of the retrieval SQL, not a post-filter.
  const result=await this.q.query<{body:string;score:number}>(`SELECT m.body,1-(v.vector <=> $4::vector) AS score FROM team_vectors v JOIN team_memories m ON m.pool=v.pool AND m.id=v.id JOIN team_members a ON a.pool=v.pool AND a.actor=$1 JOIN team_users u ON u.id=a.actor AND u.active=1 WHERE v.pool=$2 AND v.model=$3 AND v.backend='local' ORDER BY v.vector <=> $4::vector,m.id LIMIT $5`,[actor,pool,provider.identity,JSON.stringify(vectors[0]),limit]);await this.getPool(actor,pool);return result.rows.map(r=>({...JSON.parse(r.body) as Memory,score:Number(r.score)}));
 }
}
