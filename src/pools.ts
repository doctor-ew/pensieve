import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Pool { name: string; home: string; project?: string }
export interface Settings { pools: Pool[]; shareService?: string; shareToken?: string }
export function settingsDir() { return process.env.PENSIEVE_CONFIG_HOME ?? join(homedir(), '.pensieve'); }
export function settings(): Settings {
  try { return JSON.parse(readFileSync(join(settingsDir(), 'settings.json'), 'utf8')) as Settings; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pools: [] }; throw error; }
}
export function saveSettings(value: Settings) {
  const dir = settingsDir(); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `settings-${randomBytes(8).toString('hex')}.tmp`);
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(temp, join(dir, 'settings.json'));
}
export function registerPool(name: string, home: string, project?: string): Pool {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Use a short pool name with lowercase letters, numbers, or hyphens');
  const config = settings(); const pool = { name, home: resolve(home), ...(project ? { project: resolve(project) } : {}) };
  const previous = config.pools.find(p => p.name === name);
  if (previous && previous.home !== pool.home) throw new Error('That pool name already points to another directory');
  config.pools = [...config.pools.filter(p => p.name !== name), pool]; saveSettings(config); return pool;
}
export function resolvePool(name?: string, home?: string): Pool {
  if (home) return { name: name ?? 'memory-pool', home: resolve(home) };
  const pools = settings().pools;
  if (name) {
    const pool = pools.find(p => p.name === name);
    if (!pool) throw new Error(`Unknown pool "${name}". Run pensieve pools to see registered pools.`);
    return pool;
  }
  const projectPool = pools.find(p => p.project === process.cwd());
  if (projectPool) return projectPool;
  if (pools.length === 1) return pools[0];
  if (pools.length > 1) throw new Error('Choose a pool name. Run pensieve pools to see your pools.');
  return { name: 'memory-pool', home: join(homedir(), '.pensieve') };
}
