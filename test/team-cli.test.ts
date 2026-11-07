import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { makeMemory } from '../src/sessions.js';
import { TeamStore } from '../src/team-store.js';
import { ShareStore } from '../src/executive.js';
import { Store } from '../src/store.js';
import { createTeamServer } from '../src/team-server.js';
const exec = promisify(execFile);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pensieve-cli-integration-')); const home = join(root, 'home');
  const reservation = netServer(); await new Promise<void>(r => reservation.listen(0, '127.0.0.1', r));
  const address = reservation.address(); assert.ok(address && typeof address !== 'string'); const port = address.port;
  await new Promise<void>(r => reservation.close(() => r())); const base = `http://127.0.0.1:${port}`;
  const store = new TeamStore(':memory:'); const shares = new ShareStore(':memory:'); const alice = store.createUser('Synthetic CLI Alice'); const bob = store.createUser('Synthetic CLI Bob');
  const pool = store.createPool(alice.user.id, 'Synthetic build', 'shared'); store.grantMember(alice.user.id, pool.id, bob.user.id, 'writer');
  let loseNextCaptureResponse = false;
  const server = createTeamServer(store, { publicUrl: base, ownerToken: 'synthetic-operator-'.repeat(4), shareStore: shares,
    provider: { identity: 'synthetic-cli', embed: async texts => texts.map(() => [1, 0]) },
    handleExtra: async (req, res) => { if (loseNextCaptureResponse && req.method === 'POST' && req.url?.endsWith('/memories')) { loseNextCaptureResponse = false; res.end = (() => { res.destroy(); return res; }) as typeof res.end; } return false; },
  });
  const start = () => new Promise<void>(r => server.listen(port, '127.0.0.1', r));
  const stop = () => new Promise<void>(r => server.close(() => r())); await start();
  const cli = async (args: string[], token?: string, overrides: Record<string,string> = {}) => {
    const env = { ...process.env }; delete env.PENSIEVE_TEAM_TOKEN; delete env.PENSIEVE_TEAM_URL;
    if (token) env.PENSIEVE_TEAM_TOKEN = token; Object.assign(env, overrides);
    return await exec(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args, '--home', home], { cwd: resolve('.'), env, timeout: 20_000, maxBuffer: 2_000_000 });
  };
  const watch = (args: string[], onPending?: () => Promise<void>) => new Promise<string>((resolveWatch, reject) => {
    const env = { ...process.env }; delete env.PENSIEVE_TEAM_TOKEN; delete env.PENSIEVE_TEAM_URL;
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), ...args, '--home', home], { cwd: resolve('.'), env });
    let output = ''; let errors = ''; let completed = false; let resumed = false;
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Watcher did not report capture: ' + errors)); }, 10_000);
    child.stdout.on('data', chunk => { output += chunk; if (onPending && !resumed && output.includes('"held"')) { resumed = true; void onPending().catch(reject); } if (onPending ? /"sent": 1/.test(output) : output.includes('"held"')) { completed = true; child.kill('SIGTERM'); } });
    child.stderr.on('data', chunk => { errors += chunk; }); child.once('error', reject);
    child.once('exit', () => { clearTimeout(timeout); if (completed) resolveWatch(output); else reject(new Error('Watcher failed: ' + errors)); });
  });
  const config = async (name: string, content: string) => { const path = join(root, name + '.toml'); await writeFile(path, content); return path; };
  const close = async () => { if (server.listening) await stop(); store.close(); shares.close(); await rm(root, { recursive: true, force: true }); };
  return { root, home, base, store, alice, bob, pool, cli, watch, config, start, stop, close, dropResponse: () => { loseNextCaptureResponse = true; } };
}

test('CLI connect/save/search/export/unpack carries selected reasoning and contributor provenance', { timeout: 40_000 }, async () => {
  const f = await fixture();
  try {
    const connected = await f.cli(['connect', f.base], f.alice.token); assert.ok(!connected.stdout.includes(f.alice.token));
    assert.equal((await stat(join(f.home, 'team-connection.json'))).mode & 0o777, 0o600);
    const project = join(f.root, 'synthetic-project');
    const saved = await f.cli(['save', 'Synthetic database decision for engineering', '--pool', f.pool.id, '--project', project, '--session', 'synthetic-decision', '--citation', 'https://example.com/synthetic-source', '--ticket', 'SYN-123']);
    assert.equal(JSON.parse(saved.stdout).sent, 1);
    await f.cli(['save', 'Synthetic separate audience detail', '--pool', f.pool.id]);
    const original = f.store.listMemories(f.alice.user.id, f.pool.id).find(row => row.memory.text.includes('database'))!;
    assert.equal(original.contributorId, f.alice.user.id); assert.equal(original.memory.kind, 'distilled');
    await f.cli(['team-index', '--pool', f.pool.id]);
    const recalled = JSON.parse((await f.cli(['recall', 'database', '--pool', f.pool.id])).stdout); assert.ok(recalled.some((m: { id: string }) => m.id === original.memory.id));
    const bundleFile = join(f.root, 'handoff.json');
    await f.cli(['team-export', bundleFile, '--pool', f.pool.id, '--ids', original.memory.id]);
    const raw = await readFile(bundleFile, 'utf8'); const bundle = JSON.parse(raw);
    assert.deepEqual(bundle.memories.map((m: { id: string }) => m.id), [original.memory.id]); assert.ok(!raw.includes('separate audience')); assert.ok(!raw.includes(f.alice.token));
    assert.equal(bundle.provenance[0].contributorId, f.alice.user.id); assert.equal(bundle.provenance[0].verification, 'source-server');
    const destination = join(f.root, 'other-machine'); await f.cli(['unpack', bundleFile, '--project', destination]);
    const context = JSON.parse((await readFile(join(destination, '.pensieve/context.jsonl'), 'utf8')).trim());
    assert.equal(context.id, original.memory.id); assert.equal(context.project, project); assert.equal(context.ticket, 'SYN-123'); assert.deepEqual(context.citations, ['https://example.com/synthetic-source']);
    const imported = JSON.parse((await readFile(join(destination, '.pensieve/provenance.jsonl'), 'utf8')).trim());
    assert.equal(imported.contributorId, f.alice.user.id); assert.equal(imported.verification, 'unverified-import');
    assert.match(await readFile(join(destination, '.pensieve/START-HERE.md'), 'utf8'), /untrusted historical data/);
  } finally { await f.close(); }
});

test('CLI saves privately or disables capture without requiring a connection', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    await f.stop();
    const privateResult = JSON.parse((await f.cli(['save', 'Synthetic local-only reasoning'])).stdout); assert.equal(privateResult.destination, 'private');
    const off = await f.config('off', '[team]\ndestination="off"\n');
    const disabled = JSON.parse((await f.cli(['save', 'Synthetic must not save', '--config', off])).stdout); assert.equal(disabled.saved, false);
    const malformed = await f.config('malformed', '[team]\ndestination=\n');
    await assert.rejects(f.cli(['save', 'Synthetic malformed settings must not publish', '--config', malformed]));
    const local = new Store(join(f.home, 'memory.sqlite')); try { assert.deepEqual(local.list().map(m => m.text), ['Synthetic local-only reasoning']); } finally { local.close(); }
    assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 0);
  } finally { await f.close(); }
});

test('CLI outbox survives offline and ambiguous acknowledgments, then syncs idempotently', { timeout: 40_000 }, async () => {
  const f = await fixture();
  try {
    await f.cli(['connect', f.base], f.alice.token); await f.stop();
    const pending = JSON.parse((await f.cli(['save', 'Synthetic offline contribution', '--pool', f.pool.id])).stdout); assert.equal(pending.pending, 1); assert.equal(pending.sent, 0);
    await f.start(); f.dropResponse();
    await f.cli(['sync', '--pool', f.pool.id]); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 1);
    const retry = await f.cli(['sync', '--pool', f.pool.id]); assert.match(retry.stdout, /"pending": 0/);
    await f.cli(['sync', '--pool', f.pool.id]); const rows = f.store.listMemories(f.alice.user.id, f.pool.id); assert.equal(rows.length, 1);
    const local = new Store(join(f.home, 'memory.sqlite')); try { assert.deepEqual(local.list().map(m => m.id), [rows[0].memory.id]); assert.ok(local.bundle([rows[0].memory.id]).provenance?.length); } finally { local.close(); }
  } finally { await f.close(); }
});

test('CLI sync holds queued data after off/private/target changes and account switch', { timeout: 50_000 }, async () => {
  const f = await fixture();
  try {
    await f.cli(['connect', f.base], f.alice.token); await f.stop(); await f.cli(['save', 'Synthetic held contribution', '--pool', f.pool.id]); await f.start();
    const other = f.store.createPool(f.alice.user.id, 'Other destination', 'shared');
    for (const [name, policy] of [['off', 'destination="off"'], ['private', 'destination="private"'], ['changed', `destination="shared"\npool="${other.id}"`]]) {
      const config = await f.config(name, '[team]\n' + policy + '\n'); const result = await f.cli(['sync', '--pool', f.pool.id, '--config', config]); assert.match(result.stdout, /"held": 1/);
      assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 0); assert.equal(f.store.listMemories(f.alice.user.id, other.id).length, 0);
    }
    await f.cli(['connect', f.base], f.bob.token); const result = await f.cli(['sync', '--pool', f.pool.id]); assert.match(result.stdout, /"held": 1/); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 0);
    await f.cli(['connect', f.base], f.alice.token); await f.cli(['sync', '--pool', f.pool.id]); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 1);
  } finally { await f.close(); }
});


test('CLI sync rechecks the queued original policy file even when invoked with another config', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const original = await f.config('original', `[team]\ndestination="shared"\npool="${f.pool.id}"\n`);
    const permissive = await f.config('other', `[team]\ndestination="shared"\npool="${f.pool.id}"\n`);
    await f.cli(['connect', f.base], f.alice.token); await f.stop();
    await f.cli(['save', 'Synthetic origin-bound queued memory', '--config', original]); await f.start();
    await writeFile(original, '[team]\ndestination="off"\n');
    const held = await f.cli(['sync', '--pool', f.pool.id, '--config', permissive]); assert.match(held.stdout, /"held": 1/); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 0);
    await writeFile(original, `[team]\ndestination="shared"\npool="${f.pool.id}"\n`);
    await f.cli(['sync', '--pool', f.pool.id, '--config', permissive]); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 1);
  } finally { await f.close(); }
});

test('CLI watcher respects actual session overrides and remote automatic capture consent', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    await f.cli(['connect', f.base], f.alice.token);
    const project = join(f.root, 'synthetic-watched-project'); const session = 'synthetic-real-session-id';
    const config = await f.config('watch', `[team]\ndestination="shared"\npool="${f.pool.id}"\nautoSave=true\n`);
    const path = join(f.root, 'synthetic-session.jsonl');
    await writeFile(path, [
      { type: 'session_meta', payload: { id: session, cwd: project } },
      { type: 'response_item', timestamp: '2026-01-01T00:00:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic watched reasoning' }] } },
      { type: 'session_meta', payload: { id: 'foreign-session', cwd: project + '-other' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Synthetic foreign project should stay out' }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n');
    f.store.setPolicy(f.alice.user.id, f.pool.id, 'team', '', { destination: 'shared', pool: f.pool.id, autoSave: true });
    f.store.setPolicy(f.alice.user.id, f.pool.id, 'conversation', session, { destination: 'off' });
    const watched = await f.watch(['watch-session', 'codex', path, '--project', project, '--config', config]); assert.match(watched, /"held": 1/); assert.equal(f.store.listMemories(f.alice.user.id, f.pool.id).length, 0);
    f.store.setPolicy(f.alice.user.id, f.pool.id, 'conversation', session, { destination: 'shared', pool: f.pool.id, autoSave: false });
    assert.match((await f.cli(['sync', '--pool', f.pool.id, '--config', config])).stdout, /"held": 1/);
    f.store.setPolicy(f.alice.user.id, f.pool.id, 'conversation', session, { destination: 'shared', pool: f.pool.id, autoSave: true });
    await f.cli(['sync', '--pool', f.pool.id, '--config', config]);
    const memories = f.store.listMemories(f.alice.user.id, f.pool.id); assert.equal(memories.length, 1); assert.equal(memories[0].memory.session, session); assert.equal(memories[0].memory.kind, 'raw');
  } finally { await f.close(); }
});


test('CLI team-import preserves historical provenance across private and offline shared imports', { timeout: 30_000 }, async () => {
  const f = await fixture();
  try {
    const memory = { ...makeMemory({text:'Synthetic historical imported reasoning',source:'manual',session:'historic-synthetic',role:'assistant',timestamp:'2026-01-01T00:00:00Z',locator:'synthetic-origin',project:'/synthetic/original-machine'}),kind:'distilled' as const,synthetic:true };
    f.store.putMemory(f.alice.user.id,f.pool.id,memory); const bundle=f.store.exportBundle(f.alice.user.id,f.pool.id,[memory.id]);
    const file=join(f.root,'historical.json'); await writeFile(file,JSON.stringify(bundle));
    await f.stop();
    const localResult=JSON.parse((await f.cli(['team-import',file])).stdout); assert.equal(localResult.destination,'private'); assert.equal(localResult.imported,1);
    const off=await f.config('import-off','[team]\ndestination="off"\n'); assert.equal(JSON.parse((await f.cli(['team-import',join(f.root,'does-not-exist.json'),'--config',off])).stdout).imported,0);
    await f.start(); const target=f.store.createPool(f.bob.user.id,'Imported handoff','shared'); await f.cli(['connect',f.base],f.bob.token); await f.stop();
    assert.equal(JSON.parse((await f.cli(['team-import',file,'--pool',target.id])).stdout).pending,1);
    await f.start(); await f.cli(['sync','--pool',target.id]); await f.cli(['team-import',file,'--pool',target.id]);
    const rows=f.store.listMemories(f.bob.user.id,target.id); assert.equal(rows.length,1); assert.equal(rows[0].contributorId,f.bob.user.id); assert.deepEqual(rows[0].memory,memory);
    const imported=f.store.exportBundle(f.bob.user.id,target.id,[memory.id]);
    assert.ok(imported.provenance?.some(p=>p.contributorId===f.alice.user.id && p.verification==='unverified-import'));
    assert.ok(imported.provenance?.some(p=>p.contributorId===f.bob.user.id && p.verification==='source-server'));
  } finally { await f.close(); }
});

test('CLI changed server requires its own credential before any network request', { timeout: 20_000 }, async () => {
  const f=await fixture(); let received=false;
  const other=httpServer((_req,res)=>{received=true;res.setHeader('Content-Type','application/json');res.end('{"pools":[]}');});
  await new Promise<void>(r=>other.listen(0,'127.0.0.1',r)); const address=other.address(); assert.ok(address && typeof address!=='string');
  try {
    await f.cli(['connect',f.base],f.alice.token);
    await assert.rejects(f.cli(['team-pools'],undefined,{PENSIEVE_TEAM_URL:`http://127.0.0.1:${address.port}`})); assert.equal(received,false);
  } finally { await new Promise<void>(r=>other.close(()=>r())); await f.close(); }
});

test('CLI watcher retries queued capture after recovery without a new session message', { timeout: 20_000 }, async () => {
  const f=await fixture();
  try {
    await f.cli(['connect',f.base],f.alice.token); const project=join(f.root,'retry-project');
    const path=join(f.root,'retry-session.jsonl'); await writeFile(path,[{type:'session_meta',payload:{id:'synthetic-retry-session',cwd:project}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic unchanged session message'}]}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
    const config=await f.config('retry-watch',`[team]\ndestination="shared"\npool="${f.pool.id}"\nautoSave=true\n`);
    await f.stop(); const output=await f.watch(['watch-session','codex',path,'--project',project,'--config',config,'--interval','1000'],async()=>{await new Promise(resolve=>setTimeout(resolve,1200));await f.start();});
    assert.match(output,/"sent": 1/); assert.equal(f.store.listMemories(f.alice.user.id,f.pool.id).length,1);
  } finally { await f.close(); }
});
