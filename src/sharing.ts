import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { validateBundle } from './store.js';
import type { Bundle } from './types.js';

export async function writeBundle(path: string, bundle: Bundle) {
  await writeFile(path, JSON.stringify(bundle, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
export async function readBundle(path: string): Promise<Bundle> {
  const raw = await readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > 10_000_000) throw new Error('Bundle exceeds 10 MB');
  return validateBundle(JSON.parse(raw));
}
export async function gitExport(repo: string, name: string, bundle: Bundle) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Bundle name must contain only letters, numbers, hyphens, and underscores');
  const root = execFileSync('git', ['-C', resolve(repo), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const path = join(root, `pensieve-${name}.json`);
  await writeBundle(path, bundle);
  return path; // Deliberately leaves commit/push to the user for review.
}
export async function exchange(url: string, token: string, bundle?: Bundle): Promise<Bundle | { imported: number }> {
  const endpoint = new URL('/api/bundle', url);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('Remote workspaces require HTTPS');
  if (!token) throw new Error('Set PENSIEVE_REMOTE_TOKEN');
  const response = await fetch(endpoint, {
    method: bundle ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: bundle ? JSON.stringify(bundle) : undefined,
  });
  if (!response.ok) throw new Error(`Workspace request failed (${response.status})`);
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 10_000_000) throw new Error('Workspace response exceeds 10 MB');
  return bundle ? JSON.parse(raw) as { imported: number } : validateBundle(JSON.parse(raw));
}
