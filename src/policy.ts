import { parse } from 'smol-toml';

export interface CapturePolicy { destination: 'private' | 'shared' | 'off'; pool?: string; autoSave?: boolean }
export interface PolicyLayers { team?: CapturePolicy; repository?: CapturePolicy; conversation?: CapturePolicy }
export function validateCapturePolicy(value: unknown): CapturePolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid capture policy');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !['destination', 'pool', 'autoSave'].includes(k))) throw new Error('Unknown policy field');
  if (!['private', 'shared', 'off'].includes(p.destination as string)) throw new Error('Invalid policy destination');
  if (p.autoSave !== undefined && typeof p.autoSave !== 'boolean') throw new Error('Invalid policy autoSave');
  if (p.destination === 'shared') {
    if (typeof p.pool !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.pool)) throw new Error('Invalid shared policy pool');
  } else if (p.pool !== undefined) throw new Error('Private/off policy cannot contain a pool');
  if (p.destination === 'off' && p.autoSave === true) throw new Error('Off policy cannot autoSave');
  return { destination: p.destination as CapturePolicy['destination'], ...(p.pool === undefined ? {} : { pool: p.pool as string }), autoSave: p.autoSave === true };
}
export function resolvePolicy(layers: { team?: unknown; repository?: unknown; conversation?: unknown }): CapturePolicy {
  let result: CapturePolicy = { destination: 'private', autoSave: false };
  for (const key of ['team', 'repository', 'conversation'] as const) if (layers[key] !== undefined) result = validateCapturePolicy(layers[key]);
  return result;
}
export function parsePolicyToml(text: string): PolicyLayers {
  const parsed = parse(text); const layers: PolicyLayers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!['team', 'repository', 'conversation'].includes(key)) throw new Error('Unknown policy scope');
    layers[key as keyof PolicyLayers] = validateCapturePolicy(value);
  }
  return layers;
}
