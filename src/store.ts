import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { cosine, validateVector } from './embeddings.js';
import type { Bundle, EmbeddingProvider, Hit, Memory } from './types.js';

export function validateBundle(value: unknown): Bundle {
  const bundle = value as Bundle;
  if (!bundle || bundle.format !== 'pensieve/v1' || typeof bundle.createdAt !== 'string' || !Array.isArray(bundle.memories) || bundle.memories.length > 10_000) throw new Error('Invalid pensieve/v1 bundle');
  const ids = new Set<string>();
  for (const m of bundle.memories) {
    if (!m || !['id', 'text', 'session', 'timestamp', 'locator', 'project'].every(k => typeof m[k as keyof Memory] === 'string') ||
      !/^[a-f0-9]{64}$/.test(m.id) || !m.text.trim() || m.text.length > 10_000 ||
      !['codex', 'claude', 'manual'].includes(m.source) || !['user', 'assistant'].includes(m.role) || ids.has(m.id)) throw new Error('Invalid or duplicate memory in bundle');
    ids.add(m.id);
  }
  return bundle;
}

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, mode: 'private' | 'workspace' = 'private') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vectors (id TEXT NOT NULL REFERENCES memories(id), model TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(id,model));`);
    const existing = this.db.prepare('SELECT value FROM metadata WHERE key=?').get('mode') as { value: string } | undefined;
    const populated = Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories').get()!.n) > 0;
    if ((existing && existing.value !== mode) || (!existing && populated && mode === 'workspace')) {
      this.db.close(); throw new Error('Store mode mismatch: use a separate directory for a shared workspace');
    }
    this.db.prepare('INSERT OR IGNORE INTO metadata VALUES (?,?)').run('mode', mode);
  }
  close() { this.db.close(); }
  add(memories: Memory[]): number {
    let count = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO memories VALUES (?,?)');
      const existing = this.db.prepare('SELECT body FROM memories WHERE id=?');
      for (const m of memories) {
        const old = existing.get(m.id) as { body: string } | undefined;
        if (old && JSON.stringify(JSON.parse(old.body)) !== JSON.stringify(m)) throw new Error(`Conflicting content for memory ${m.id}`);
        count += Number(insert.run(m.id, JSON.stringify(m)).changes);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return count;
  }
  list(): Memory[] {
    return (this.db.prepare('SELECT body FROM memories ORDER BY rowid DESC').all() as { body: string }[]).map(x => JSON.parse(x.body) as Memory);
  }
  get(id: string): Memory {
    const row = this.db.prepare('SELECT body FROM memories WHERE id=?').get(id) as { body: string } | undefined;
    if (!row) throw new Error(`Unknown memory: ${id}`);
    return JSON.parse(row.body) as Memory;
  }
  stats() {
    return { memories: Number(this.db.prepare('SELECT COUNT(*) AS n FROM memories').get()!.n),
      indexes: this.db.prepare('SELECT model,COUNT(*) AS count FROM vectors GROUP BY model').all() };
  }
  async index(provider: EmbeddingProvider): Promise<number> {
    const rows = this.db.prepare('SELECT body FROM memories WHERE id NOT IN (SELECT id FROM vectors WHERE model=?)').all(provider.identity) as { body: string }[];
    let count = 0;
    const insert = this.db.prepare('INSERT OR IGNORE INTO vectors VALUES (?,?,?)');
    const prior = this.db.prepare('SELECT vector FROM vectors WHERE model=? LIMIT 1').get(provider.identity) as { vector: string } | undefined;
    let dimension: number | undefined = prior ? JSON.parse(prior.vector).length : undefined;
    for (let i = 0; i < rows.length; i += 16) {
      const memories = rows.slice(i, i + 16).map(x => JSON.parse(x.body) as Memory);
      const vectors = await provider.embed(memories.map(m => m.text), 'document');
      if (vectors.length !== memories.length) throw new Error('Embedding response count mismatch');
      for (const vector of vectors) {
        validateVector(vector); dimension ??= vector.length;
        if (vector.length !== dimension) throw new Error('Embedding dimension changed; use a distinct model identity');
      }
      this.db.exec('BEGIN IMMEDIATE');
      try {
        memories.forEach((m, n) => { count += Number(insert.run(m.id, provider.identity, JSON.stringify(vectors[n])).changes); });
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    return count;
  }
  async search(query: string, provider: EmbeddingProvider, limit = 8): Promise<Hit[]> {
    if (!query.trim()) throw new Error('A search query is required');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Limit must be between 1 and 100');
    const rows = this.db.prepare('SELECT m.body,v.vector FROM memories m JOIN vectors v ON m.id=v.id WHERE model=?').all(provider.identity) as { body: string; vector: string }[];
    if (!rows.length) throw new Error(`No indexed memories for ${provider.identity}. Run pensieve index first.`);
    const [queryVector] = await provider.embed([query], 'query');
    validateVector(queryVector);
    return rows.map(row => ({ ...JSON.parse(row.body) as Memory, score: cosine(queryVector, JSON.parse(row.vector)) }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }
  bundle(ids: string[]): Bundle {
    if (!ids.length) throw new Error('Select at least one memory explicitly');
    return { format: 'pensieve/v1', createdAt: new Date().toISOString(), memories: [...new Set(ids)].map(id => this.get(id)) };
  }
}
