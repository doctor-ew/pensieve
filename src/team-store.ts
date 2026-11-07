import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { cosine, validateVector } from './embeddings.js';
import { validateMemoryRecord, validateProvenance } from './memory-record.js';
import { validateCapturePolicy, type PolicyLayers } from './policy.js';
import type { Bundle, EmbeddingProvider, Hit, Memory, MemoryProvenance } from './types.js';
import type { VectorBackend } from './vector-backend.js';

export interface TeamUser { id: string; name: string }
export interface TeamPool { id: string; name: string; visibility: 'private' | 'shared'; role: 'owner' | 'writer' | 'reader' }
export interface TeamMember { userId: string; name: string; role: TeamPool['role'] }
export interface TeamMemory { memory: Memory; contributorId: string; createdAt: string }
export interface TeamShare { shareId: string; poolId: string; creatorId: string; ids: string[] }
export class TeamAccessError extends Error {
  constructor(public readonly status: 401 | 403 | 404, message: string) { super(message); }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function bounded(value: unknown, name: string, max = 512): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
}
// Canonical object key order makes JSON representation differences idempotent.
function canonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => [k,normalize(x)])) : v;
  return JSON.stringify(normalize(value));
}
export class TeamStore {
  private readonly db: DatabaseSync;
  readonly sourceServer: string;
  constructor(path: string, private readonly vectorBackend?: VectorBackend) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS team_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS team_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,token TEXT UNIQUE NOT NULL,active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS team_pools(id TEXT PRIMARY KEY,name TEXT NOT NULL,visibility TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS team_members(pool TEXT NOT NULL REFERENCES team_pools(id),actor TEXT NOT NULL REFERENCES team_users(id),role TEXT NOT NULL,PRIMARY KEY(pool,actor));
      CREATE TABLE IF NOT EXISTS team_memories(pool TEXT NOT NULL REFERENCES team_pools(id),id TEXT NOT NULL,body TEXT NOT NULL,contributor TEXT NOT NULL REFERENCES team_users(id),created TEXT NOT NULL,PRIMARY KEY(pool,id));
      CREATE TABLE IF NOT EXISTS team_origins(pool TEXT NOT NULL,id TEXT NOT NULL,origin TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(pool,id,origin),FOREIGN KEY(pool,id) REFERENCES team_memories(pool,id));
      CREATE TABLE IF NOT EXISTS team_vectors(pool TEXT NOT NULL,id TEXT NOT NULL,model TEXT NOT NULL,backend TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(pool,id,model,backend),FOREIGN KEY(pool,id) REFERENCES team_memories(pool,id));
      CREATE TABLE IF NOT EXISTS team_shares(id TEXT PRIMARY KEY,pool TEXT NOT NULL REFERENCES team_pools(id),creator TEXT NOT NULL REFERENCES team_users(id),ids TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS team_policies(actor TEXT NOT NULL REFERENCES team_users(id),pool TEXT NOT NULL REFERENCES team_pools(id),scope TEXT NOT NULL,context TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(actor,pool,scope,context));`);
    this.db.prepare('INSERT OR IGNORE INTO team_meta VALUES (?,?)').run('issuer',randomUUID());
    this.sourceServer = this.db.prepare('SELECT value FROM team_meta WHERE key=?').get('issuer')!.value as string;
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  createUser(name: string) {
    bounded(name,'user name',160); const user = { id: randomUUID(), name: name.trim() }; const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO team_users(id,name,token) VALUES (?,?,?)').run(user.id,user.name,digest(token));
    return { user, token };
  }
  getUser(id: string): TeamUser {
    const user = this.db.prepare('SELECT id,name FROM team_users WHERE id=? AND active=1').get(id) as unknown as TeamUser | undefined;
    if (!user) throw new TeamAccessError(401,'Unauthorized identity');
    return { id:user.id, name:user.name };
  }
  authenticate(token: string): TeamUser {
    if (typeof token !== 'string' || token.length > 512) throw new TeamAccessError(401,'Unauthorized authentication');
    const row = this.db.prepare('SELECT id FROM team_users WHERE token=? AND active=1').get(digest(token));
    if (!row) throw new TeamAccessError(401,'Unauthorized authentication');
    return this.getUser(row.id as string);
  }
  revokeUser(userId: string) { this.db.prepare('UPDATE team_users SET active=0 WHERE id=?').run(userId); }
  createPool(actor: string, name: string, visibility: TeamPool['visibility']): TeamPool {
    this.getUser(actor); bounded(name,'pool name',160);
    if (!['private','shared'].includes(visibility)) throw new Error('Invalid pool visibility');
    const pool: TeamPool = { id: randomUUID(), name: name.trim(), visibility, role:'owner' };
    this.transaction(() => { this.db.prepare('INSERT INTO team_pools VALUES (?,?,?)').run(pool.id,pool.name,visibility); this.db.prepare('INSERT INTO team_members VALUES (?,?,?)').run(pool.id,actor,'owner'); }); return pool;
  }
  listPools(actor: string): TeamPool[] {
    this.getUser(actor);
    return this.db.prepare('SELECT p.id,p.name,p.visibility,m.role FROM team_pools p JOIN team_members m ON m.pool=p.id WHERE m.actor=? ORDER BY p.rowid').all(actor) as unknown as TeamPool[];
  }
  getPool(actor: string, pool: string): TeamPool {
    this.getUser(actor);
    const row = this.db.prepare('SELECT p.id,p.name,p.visibility,m.role FROM team_pools p JOIN team_members m ON m.pool=p.id WHERE m.actor=? AND p.id=?').get(actor,pool) as unknown as TeamPool | undefined;
    if (!row) throw new TeamAccessError(404,'Pool unavailable'); return row;
  }
  private writable(actor: string,pool: string) { const p = this.getPool(actor,pool); if (p.role === 'reader') throw new TeamAccessError(403,'Writer authorization required'); return p; }
  grantMember(actor: string,pool: string,userId: string,role: 'reader'|'writer') {
    const p = this.getPool(actor,pool); if (p.role !== 'owner') throw new TeamAccessError(403,'Pool owner required');
    if (p.visibility === 'private') throw new TeamAccessError(403,'Private pools cannot grant membership');
    if (!['reader','writer'].includes(role)) throw new Error('Invalid membership role'); this.getUser(userId);
    const prior = this.db.prepare('SELECT role FROM team_members WHERE pool=? AND actor=?').get(pool,userId);
    if (prior?.role === 'owner') throw new TeamAccessError(403,'Cannot replace pool owner');
    this.db.prepare('INSERT INTO team_members VALUES (?,?,?) ON CONFLICT(pool,actor) DO UPDATE SET role=excluded.role').run(pool,userId,role);
  }
  listMembers(actor: string,pool: string): TeamMember[] {
    this.getPool(actor,pool); return this.db.prepare('SELECT u.id AS userId,u.name,m.role FROM team_members m JOIN team_users u ON u.id=m.actor WHERE m.pool=? AND u.active=1').all(pool) as unknown as TeamMember[];
  }
  putMemory(actor: string,pool: string,memory: Memory) { const result = this.putMemories(actor,pool,[memory]); return { id:memory.id, created:result.imported === 1 }; }
  putMemories(actor: string,pool: string,memories: Memory[],provenance?: MemoryProvenance[]) {
    this.writable(actor,pool);
    if (!Array.isArray(memories) || !memories.length || memories.length > 10_000) throw new Error('Invalid memory batch');
    memories.forEach(validateMemoryRecord); const ids = [...new Set(memories.map(m => m.id))];
    const origins = provenance === undefined ? [] : validateProvenance(provenance,new Set(ids));
    return this.transaction(() => {
      let imported = 0;
      for (const m of memories) {
        const body = canonical(m); const prior = this.db.prepare('SELECT body FROM team_memories WHERE pool=? AND id=?').get(pool,m.id);
        if (prior && prior.body !== body) throw new Error(`Conflicting content for memory ${m.id}`);
        imported += Number(this.db.prepare('INSERT OR IGNORE INTO team_memories VALUES (?,?,?,?,?)').run(pool,m.id,body,actor,new Date().toISOString()).changes);
      }
      for (const p of origins) {
        const origin = digest(canonical([p.sourceServer,p.poolId,p.memoryId,p.contributorId,p.createdAt]));
        this.db.prepare('INSERT OR IGNORE INTO team_origins VALUES (?,?,?,?)').run(pool,p.memoryId,origin,canonical({...p,verification:'unverified-import'}));
      }
      return { imported,ids };
    });
  }
  listMemories(actor: string,pool: string): TeamMemory[] {
    this.getPool(actor,pool);
    return (this.db.prepare('SELECT body,contributor,created FROM team_memories WHERE pool=? ORDER BY rowid').all(pool) as {body:string;contributor:string;created:string}[]).map(r => ({memory:JSON.parse(r.body),contributorId:r.contributor,createdAt:r.created}));
  }
  getMemories(actor: string,pool: string,ids: string[]): Memory[] {
    this.getPool(actor,pool); if (!Array.isArray(ids) || ids.length > 10_000 || ids.some(id => typeof id !== 'string')) throw new Error('Invalid memory selection');
    return [...new Set(ids)].map(id => { const row = this.db.prepare('SELECT body FROM team_memories WHERE pool=? AND id=?').get(pool,id); if (!row) throw new TeamAccessError(404,'Memory unavailable'); return JSON.parse(row.body as string) as Memory; });
  }
  exportBundle(actor: string,pool: string,ids: string[]): Bundle {
    this.getPool(actor,pool); if (!ids.length) throw new Error('Select at least one memory explicitly');
    const memories = this.getMemories(actor,pool,ids); const provenance: MemoryProvenance[] = [];
    for (const m of memories) {
      const row = this.db.prepare('SELECT m.contributor,m.created,u.name FROM team_memories m JOIN team_users u ON u.id=m.contributor WHERE m.pool=? AND m.id=?').get(pool,m.id)!;
      provenance.push({memoryId:m.id,contributorId:row.contributor as string,contributorName:row.name as string,poolId:pool,createdAt:row.created as string,sourceServer:this.sourceServer,verification:'source-server'});
      for (const origin of this.db.prepare('SELECT body FROM team_origins WHERE pool=? AND id=?').all(pool,m.id)) provenance.push(JSON.parse(origin.body as string));
    }
    return {format:'pensieve/v1',createdAt:new Date().toISOString(),memories,provenance};
  }
  recordShare(actor: string,pool: string,shareId: string,ids: string[]) {
    this.writable(actor,pool); bounded(shareId,'share ID'); if (!ids?.length) throw new Error('Select memories to share'); this.getMemories(actor,pool,ids);
    this.db.prepare('INSERT INTO team_shares VALUES (?,?,?,?)').run(shareId,pool,actor,JSON.stringify([...new Set(ids)]));
  }
  listShares(actor: string,pool: string): TeamShare[] {
    const p = this.writable(actor,pool);
    return (this.db.prepare('SELECT id,pool,creator,ids FROM team_shares WHERE pool=? AND (?=1 OR creator=?)').all(pool,p.role === 'owner' ? 1:0,actor) as {id:string;pool:string;creator:string;ids:string}[]).map(r => ({shareId:r.id,poolId:r.pool,creatorId:r.creator,ids:JSON.parse(r.ids)}));
  }
  authorizeShareRevocation(actor: string,pool: string,shareId: string) {
    const p = this.writable(actor,pool); const row = this.db.prepare('SELECT creator FROM team_shares WHERE id=? AND pool=?').get(shareId,pool);
    if (!row || (p.role !== 'owner' && row.creator !== actor)) throw new TeamAccessError(404,'Share unavailable');
  }
  setPolicy(actor: string,pool: string,scope: keyof PolicyLayers,key: string,policy: unknown) {
    const access = this.writable(actor,pool);
    if (scope === 'team' && access.role !== 'owner') throw new TeamAccessError(403,'Pool owner required for team policy');
    if (!['team','repository','conversation'].includes(scope)) throw new Error('Invalid policy scope');
    if (scope === 'team') { if (key !== '') throw new Error('Team policy uses empty context'); } else bounded(key,'policy context',4096);
    const validated = validateCapturePolicy(policy); if (validated.destination === 'shared') { const target = this.writable(actor,validated.pool!); if (target.visibility !== 'shared') throw new Error('Shared policy requires a shared pool'); }
    this.db.prepare('INSERT INTO team_policies VALUES (?,?,?,?,?) ON CONFLICT(actor,pool,scope,context) DO UPDATE SET body=excluded.body').run(actor,pool,scope,key,JSON.stringify(validated));
  }
  getPolicies(actor: string,pool: string,repository?: string,conversation?: string): PolicyLayers {
    this.getPool(actor,pool); const result: PolicyLayers = {};
    for (const [scope,key] of [['team',''],['repository',repository],['conversation',conversation]] as const) if (key !== undefined) {
      const policyActor = scope === 'team' ? this.db.prepare("SELECT actor FROM team_members WHERE pool=? AND role='owner'").get(pool)!.actor as string : actor;
      const row = this.db.prepare('SELECT body FROM team_policies WHERE actor=? AND pool=? AND scope=? AND context=?').get(policyActor,pool,scope,key);
      if (row) result[scope] = validateCapturePolicy(JSON.parse(row.body as string));
    }
    return result;
  }
  private vectorRows(pool: string,model: string) {
    return this.db.prepare('SELECT m.body,v.vector FROM team_memories m JOIN team_vectors v ON m.pool=v.pool AND m.id=v.id WHERE v.pool=? AND v.model=? AND v.backend=?').all(pool,model,this.vectorBackend?.identity ?? 'local') as {body:string;vector:string}[];
  }
  async index(actor: string,pool: string,provider: EmbeddingProvider): Promise<number> {
    this.writable(actor,pool); bounded(provider.identity,'model identity');
    const backend = this.vectorBackend?.identity ?? 'local'; const prior = this.vectorRows(pool,provider.identity);
    const rows = this.db.prepare('SELECT body FROM team_memories WHERE pool=? AND id NOT IN (SELECT id FROM team_vectors WHERE pool=? AND model=? AND backend=?)').all(pool,pool,provider.identity,backend) as {body:string}[];
    if (!rows.length) return 0;
    let dimension: number | undefined = prior.length ? JSON.parse(prior[0].vector).length : undefined;
    const records: {id:string;vector:number[]}[] = [];
    for (let offset=0;offset<rows.length;offset+=16) {
      this.writable(actor,pool); const batch = rows.slice(offset,offset+16).map(r => JSON.parse(r.body) as Memory);
      const vectors = await provider.embed(batch.map(m => m.text),'document'); this.writable(actor,pool);
      if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new Error('Embedding response count mismatch');
      vectors.forEach((vector,n) => { validateVector(vector); dimension ??= vector.length; if (vector.length !== dimension) throw new Error('Embedding dimension changed'); records.push({id:batch[n].id,vector}); });
    }
    if (this.vectorBackend) {
      for (let offset=0;offset<records.length;offset+=10_000) {
        this.writable(actor,pool);
        await this.vectorBackend.upsert(pool,provider.identity,records.slice(offset,offset+10_000));
        this.writable(actor,pool);
      }
    }
    return this.transaction(() => {
      // Another request may finish an index while embeddings are in flight.
      const current = this.vectorRows(pool,provider.identity);
      if (current.length && JSON.parse(current[0].vector).length !== dimension) throw new Error('Embedding dimension changed');
      let count=0; for (const record of records) count += Number(this.db.prepare('INSERT OR IGNORE INTO team_vectors VALUES (?,?,?,?,?)').run(pool,record.id,provider.identity,backend,JSON.stringify(record.vector)).changes); return count;
    });
  }
  async search(actor: string,pool: string,query: string,provider: EmbeddingProvider,limit=8): Promise<Hit[]> {
    this.getPool(actor,pool); bounded(query,'search query',10_000); bounded(provider.identity,'model identity');
    if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Limit must be between 1 and 100');
    const rows = this.vectorRows(pool,provider.identity); if (!rows.length) throw new Error('No indexed memories for this model');
    const vectors = await provider.embed([query],'query'); this.getPool(actor,pool);
    if (!Array.isArray(vectors) || vectors.length !== 1) throw new Error('Embedding response count mismatch');
    const vector = vectors[0]; validateVector(vector);
    if (rows.some(r => JSON.parse(r.vector).length !== vector.length)) throw new Error('Embedding dimension mismatch');
    if (this.vectorBackend) {
      const hits = await this.vectorBackend.query(pool,provider.identity,vector,limit); this.getPool(actor,pool);
      const allowed = new Map(rows.map(r => { const m=JSON.parse(r.body) as Memory; return [m.id,m]; })); const seen = new Set<string>();
      return hits.filter(h => allowed.has(h.id) && Number.isFinite(h.score) && !seen.has(h.id) && !!seen.add(h.id)).slice(0,limit).map(h => ({...allowed.get(h.id)!,score:h.score}));
    }
    return rows.map(r => ({...JSON.parse(r.body) as Memory,score:cosine(vector,JSON.parse(r.vector))})).sort((a,b) => b.score-a.score).slice(0,limit);
  }
}
