import type { Memory, MemoryProvenance } from './types.js';

export function validateMemoryRecord(value: unknown): Memory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid memory');
  const m = value as Memory;
  const required = ['id', 'text', 'source', 'session', 'role', 'timestamp', 'locator', 'project'];
  if (Object.keys(m).some(k => ![...required, 'kind', 'citations', 'synthetic', 'ticket'].includes(k))) throw new Error('Unknown memory field');
  if (!required.every(k => typeof m[k as keyof Memory] === 'string') || !/^[a-f0-9]{64}$/.test(m.id) || !m.text.trim() || m.text.length > 10_000 || !['codex','claude','manual'].includes(m.source) || !['user','assistant'].includes(m.role)) throw new Error('Invalid memory fields');
  for (const key of ['session','timestamp','locator','project'] as const) if (m[key].length > 4096) throw new Error('Invalid memory field length');
  if (m.kind !== undefined && !['raw','distilled'].includes(m.kind)) throw new Error('Invalid memory kind');
  if (m.synthetic !== undefined && typeof m.synthetic !== 'boolean') throw new Error('Invalid memory synthetic metadata');
  if (m.ticket !== undefined && (typeof m.ticket !== 'string' || !m.ticket.trim() || m.ticket.length > 1024)) throw new Error('Invalid memory ticket');
  if (m.citations !== undefined && (!Array.isArray(m.citations) || m.citations.length > 100 || m.citations.some(c => typeof c !== 'string' || !c.trim() || c.length > 4096))) throw new Error('Invalid memory citations');
  return m;
}
export function validateProvenance(value: unknown, ids: Set<string>): MemoryProvenance[] {
  if (!Array.isArray(value) || value.length > 50_000) throw new Error('Invalid provenance');
  const keys = ['memoryId','contributorId','contributorName','poolId','createdAt','verification','sourceServer'];
  for (const p of value) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !keys.includes(k)) || !keys.every(k => typeof p[k] === 'string' && p[k].length > 0 && p[k].length <= 512) || !ids.has(p.memoryId) || !/^[a-f0-9]{64}$/.test(p.memoryId) || !['source-server','unverified-import'].includes(p.verification)) throw new Error('Invalid provenance fields or memory reference');
    if (!['contributorId','poolId','sourceServer'].every(k => /^[a-zA-Z0-9_-]{1,128}$/.test(p[k])) || !Number.isFinite(Date.parse(p.createdAt))) throw new Error('Invalid provenance identifiers or timestamp');
  }
  return value as MemoryProvenance[];
}
