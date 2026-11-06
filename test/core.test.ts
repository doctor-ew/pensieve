import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, validateBundle } from '../src/store.js';
import { discoverProject, makeMemory, readSession } from '../src/sessions.js';
import { createApp } from '../src/server.js';
import { exchange, writeBundle, readBundle } from '../src/sharing.js';
import type { EmbeddingProvider } from '../src/types.js';

const memory = (text: string) => makeMemory({ text, source: 'manual', session: 'synthetic', role: 'user', timestamp: '', locator: 'test', project: '' });
// Test-only vectors verify ranking mechanics; runtime never falls back to fake embeddings.
const provider: EmbeddingProvider = { identity: 'test:two-dimensions', embed: async texts => texts.map(text => text.includes('database') ? [1, 0] : [0, 1]) };

test('project discovery matches metadata rather than incidental conversation mentions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pensieve-discover-'));
  await writeFile(join(root, 'match.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/wanted' } }) + '\n');
  await writeFile(join(root, 'other.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/other' } }) + '\n' + JSON.stringify({ text: '/wanted' }));
  await writeFile(join(root, 'claude.jsonl'), JSON.stringify({ cwd: '/wanted', type: 'user', message: { content: 'hello' } }));
  assert.deepEqual(await discoverProject(root, 'codex', '/wanted/'), [join(root, 'match.jsonl')]);
  assert.deepEqual(await discoverProject(root, 'claude', '/wanted'), [join(root, 'claude.jsonl')]);
});

test('Codex import preserves citations, skips tool/duplicate event records, retries partial lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-parser-')), file = join(dir, 'session.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'codex-123', cwd: '/synthetic/project' } },
    { type: 'response_item', timestamp: '2026-01-01', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'database decision' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'database decision' } },
    { type: 'response_item', payload: { type: 'function_call_output', output: 'private tool output' } },
  ];
  await writeFile(file, rows.map(x => JSON.stringify(x)).join('\n') + '\n{"type":');
  const first = await readSession(file, 'codex');
  assert.equal(first.memories.length, 1); assert.equal(first.warnings.length, 1);
  assert.equal(first.memories[0].locator, 'session.jsonl:L2:C1'); assert.equal(first.memories[0].session, 'codex-123');
  await appendFile(file, '"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"agreed"}]}}\n');
  const second = await readSession(file, 'codex');
  assert.equal(second.memories.length, 2); assert.equal(second.warnings.length, 0);
  const store = new Store(':memory:');
  try { assert.equal(store.add(first.memories), 1); assert.equal(store.add(second.memories), 1); assert.equal(store.add(second.memories), 0); } finally { store.close(); }
});

test('Claude imports user and assistant text without thinking or tool payloads; chunks long messages', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-claude-')), file = join(dir, 'claude.jsonl');
  await writeFile(file, [
    { type: 'user', sessionId: 'claude-123', message: { content: 'hello' } },
    { type: 'assistant', sessionId: 'claude-123', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'omit' }, { type: 'text', text: 'x'.repeat(2500) }, { type: 'tool_use', input: { secret: 'omit' } }] } },
  ].map(x => JSON.stringify(x)).join('\n'));
  const result = await readSession(file, 'claude');
  assert.equal(result.memories.length, 3); assert.equal(result.memories[1].text.length, 2400); assert.equal(result.memories[2].text.length, 100);
  assert.ok(result.memories.every(m => !m.text.includes('omit')));
});

test('vector recall ranks by cosine, isolates models, and refuses invalid dimensions', async () => {
  const store = new Store(':memory:');
  try {
    store.add([memory('database decision'), memory('garden plan')]);
    assert.equal(await store.index(provider), 2); assert.equal(await store.index(provider), 0);
    const hits = await store.search('database', provider); assert.equal(hits[0].text, 'database decision'); assert.equal(hits[0].score, 1);
    await assert.rejects(store.search('database', { ...provider, identity: 'different-model' }), /No indexed/);
    await assert.rejects(store.search('database', { ...provider, embed: async () => [[1, 0, 0]] }), /dimension/);
    await assert.rejects(store.search('database', provider, 0), /Limit/);
  } finally { store.close(); }
});

test('bundle contains only selected memories, imports idempotently, rejects conflicts atomically', async () => {
  const store = new Store(':memory:'), target = new Store(':memory:');
  try {
    const publicMemory = memory('selected'), privateMemory = memory('do not share'); store.add([publicMemory, privateMemory]);
    assert.throws(() => store.bundle([]), /Select/);
    const bundle = store.bundle([publicMemory.id]); assert.equal(bundle.memories.length, 1); assert.ok(!JSON.stringify(bundle).includes('do not share'));
    const dir = await mkdtemp(join(tmpdir(), 'pensieve-bundle-')), path = join(dir, 'bundle.json');
    await writeBundle(path, bundle); await assert.rejects(writeBundle(path, bundle), /EEXIST/);
    assert.equal(target.add((await readBundle(path)).memories), 1); assert.equal(target.add(bundle.memories), 0);
    assert.throws(() => target.add([memory('should roll back'), { ...publicMemory, text: 'tampered' }]), /Conflicting/);
    assert.equal(target.list().length, 1);
    assert.throws(() => validateBundle({ ...bundle, memories: [{ ...publicMemory, source: 'unknown' }] }), /Invalid/);
    assert.throws(() => validateBundle({ ...bundle, memories: [publicMemory, publicMemory] }), /duplicate/);
  } finally { store.close(); target.close(); }
});

test('private stores cannot be served as shared workspaces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-boundary-')), path = join(dir, 'memory.sqlite');
  const store = new Store(path); store.add([memory('private')]); store.close();
  assert.throws(() => new Store(path, 'workspace'), /mode mismatch/);
});

test('API requires authentication, rejects foreign origins, and exports only explicit selections', async () => {
  const store = new Store(':memory:'); const m = memory('<script>untrusted</script>'); store.add([m]);
  const { server, token } = createApp(store, provider);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/api/memories')).status, 401);
    assert.equal((await fetch(base + '/api/memories', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://evil.example' } })).status, 403);
    const response = await fetch(base + '/api/export', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify({ ids: [m.id] }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).memories[0].id, m.id);
    const unselected = await fetch(base + '/api/bundle', { headers: { Authorization: 'Bearer ' + token } }); assert.equal(unselected.status, 404);
    const html = await fetch(base); assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('hosted exchange requires token and cannot invoke private capture/import/search routes', async () => {
  const store = new Store(':memory:', 'workspace'); const token = 'a'.repeat(40);
  const { server } = createApp(store, provider, { token, workspace: true });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const bundle = { format: 'pensieve/v1' as const, createdAt: '', memories: [memory('shared deliberately')] };
    await assert.rejects(exchange(base, 'wrong'), /401/);
    assert.deepEqual(await exchange(base, token, bundle), { imported: 1 });
    assert.equal(((await exchange(base, token)) as typeof bundle).memories[0].text, 'shared deliberately');
    assert.equal((await fetch(base + '/api/import-session', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: '{}' })).status, 404);
    await assert.rejects(exchange('http://example.com', token), /HTTPS/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});
