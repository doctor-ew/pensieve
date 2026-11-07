import { createHash } from 'node:crypto';
import { validateVector } from './embeddings.js';
import type { VectorBackend } from './vector-backend.js';

export interface AzureVectorOptions {
  endpoint: string; index: string; key: string; model: string; dimensions: number;
  /** Dependency injection for deterministic contract tests. */
  fetch?: typeof fetch;
}
/** Existing index schema: id (key), memoryId, poolId/model (filterable), vector (configured dimensions). */
export class AzureVectorBackend implements VectorBackend {
  readonly identity: string;
  private readonly endpoint: string;
  private readonly requestFetch: typeof fetch;
  constructor(private readonly options: AzureVectorOptions) {
    let url: URL; try { url = new URL(options.endpoint); } catch { throw new Error('Invalid Azure endpoint'); }
    if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]*\.search\.windows\.net$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Azure endpoint must be a public Azure AI Search HTTPS service origin');
    if (!/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/.test(options.index)) throw new Error('Invalid Azure index name');
    if (typeof options.key !== 'string' || !options.key.trim() || options.key.length > 4096) throw new Error('Azure credential is required');
    if (typeof options.model !== 'string' || !options.model.trim() || options.model.length > 512) throw new Error('Invalid Azure model identity');
    if (!Number.isInteger(options.dimensions) || options.dimensions < 1 || options.dimensions > 4096) throw new Error('Invalid Azure vector dimensions');
    this.endpoint = url.origin; this.requestFetch = options.fetch ?? fetch;
    this.identity = `azure:${this.endpoint}/${options.index}:${options.model}:${options.dimensions}`;
  }
  private check(pool: string,model: string,vector?: number[]) {
    if (typeof pool !== 'string' || !pool.trim() || pool.length > 512) throw new Error('Invalid Azure pool');
    if (model !== this.options.model) throw new Error('Azure embedding model identity mismatch');
    if (vector !== undefined) { validateVector(vector); if (vector.length !== this.options.dimensions) throw new Error('Azure embedding dimension mismatch'); }
  }
  private async request(route: string,body: unknown): Promise<Record<string,unknown>> {
    let response: Response;
    try {
      response = await this.requestFetch(`${this.endpoint}/indexes/${this.options.index}/docs/${route}?api-version=2024-07-01`, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),
        headers:{'Content-Type':'application/json','api-key':this.options.key},body:JSON.stringify(body),
      });
    } catch { throw new Error('Azure vector request failed'); }
    if (!response.ok || response.redirected) throw new Error(`Azure vector request failed (${response.status})`);
    let result: unknown; try { result = await response.json(); } catch { throw new Error('Invalid Azure response'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid Azure response');
    return result as Record<string,unknown>;
  }
  async upsert(pool: string,model: string,records: {id:string;vector:number[]}[]): Promise<void> {
    this.check(pool,model);
    if (!Array.isArray(records) || records.length > 10_000) throw new Error('Invalid Azure records');
    const seen = new Set<string>();
    const actions = records.map(record => {
      if (!/^[a-f0-9]{64}$/.test(record.id) || seen.has(record.id)) throw new Error('Invalid or duplicate Azure memory ID'); seen.add(record.id);
      this.check(pool,model,record.vector);
      const id = createHash('sha256').update(JSON.stringify([pool,model,record.id])).digest('hex');
      return {'@search.action':'mergeOrUpload',id,memoryId:record.id,poolId:pool,model,vector:record.vector};
    });
    for (let offset=0;offset<actions.length;offset+=100) {
      const batch=actions.slice(offset,offset+100); const result=await this.request('index',{value:batch});
      if (!Array.isArray(result.value) || result.value.length !== batch.length) throw new Error('Azure upsert item count mismatch');
      const pending=new Set(batch.map(row=>row.id));
      for (const item of result.value) {
        if (!item || typeof item !== 'object' || item.status !== true || ![200,201].includes(item.statusCode) || !pending.delete(item.key)) throw new Error('Azure upsert failed or mismatched item');
      }
      if (pending.size) throw new Error('Azure upsert missing item');
    }
  }
  async query(pool: string,model: string,vector: number[],limit: number): Promise<{id:string;score:number}[]> {
    this.check(pool,model,vector);
    if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Invalid Azure query limit');
    const literal=(value:string)=>value.replace(/'/g,"''");
    const result=await this.request('search',{
      vectorQueries:[{kind:'vector',vector,fields:'vector',k:limit}],vectorFilterMode:'preFilter',
      filter:`poolId eq '${literal(pool)}' and model eq '${literal(model)}'`,select:'memoryId',top:limit,
    });
    if (!Array.isArray(result.value) || result.value.length > 1000) throw new Error('Invalid Azure query response');
    const hits: {id:string;score:number}[]=[];
    for (const item of result.value) {
      if (!item || typeof item !== 'object' || typeof item.memoryId !== 'string' || !/^[a-f0-9]{64}$/.test(item.memoryId) || typeof item['@search.score'] !== 'number' || !Number.isFinite(item['@search.score'])) throw new Error('Invalid Azure query result');
      hits.push({id:item.memoryId,score:item['@search.score']});
    }
    return hits;
  }
}
