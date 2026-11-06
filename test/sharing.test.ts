import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShareStore, answerQuestion, type ShareInput } from '../src/executive.js';
import { createShareServer } from '../src/share-server.js';
import { makeMemory } from '../src/sessions.js';
import { registerPool, resolvePool } from '../src/pools.js';

const fixture = (): ShareInput => ({ title: 'Synthetic executive brief', brief: 'A test decision, not real project data.', recipients: ['executive@example.com'], days: 7, cloudAllowed: false,
  bundle: { format: 'pensieve/v1', createdAt: '', memories: [makeMemory({ text: 'Synthetic: database choice was SQLite for local storage.', source: 'manual', role: 'user', session: 'test', timestamp: '', locator: 'synthetic fixture', project: '' })] } });

test('invited email verification is single-use, scoped to the share, and revocable', async () => {
  const store = new ShareStore(':memory:'); const sent: { email: string; code: string }[] = [];
  const mailer = { sendCode: async (email: string, code: string) => { sent.push({ email, code }); } };
  try {
    const a = store.create(fixture()), b = store.create(fixture());
    await store.challenge(a.id, 'stranger@example.com', mailer); assert.equal(sent.length, 0);
    await store.challenge(a.id, 'executive@example.com', mailer); assert.equal(sent.length, 1);
    await store.challenge(a.id, 'executive@example.com', mailer); assert.equal(sent.length, 1, 'Resend must be throttled');
    const token = store.verify(a.id, sent[0].email, sent[0].code);
    assert.equal(store.authorize(a.id, token).title, a.title);
    assert.throws(() => store.verify(a.id, sent[0].email, sent[0].code), /expired/);
    assert.throws(() => store.authorize(b.id, token), /sign in/);
    store.revoke(a.id); assert.throws(() => store.authorize(a.id, token), /unavailable/);
  } finally { store.close(); }
});

test('incorrect codes lock out after five attempts and sessions respect expiry', async () => {
  let now = 1_000_000; const store = new ShareStore(':memory:', () => now); let code = '';
  try {
    const a = store.create(fixture()); await store.challenge(a.id, 'executive@example.com', { sendCode: async (_email, value) => { code = value; } });
    for (let i = 0; i < 5; i++) assert.throws(() => store.verify(a.id, 'executive@example.com', 'wrong'), /Invalid/);
    assert.throws(() => store.verify(a.id, 'executive@example.com', code), /Invalid/);
    now += 61_000;
    await store.challenge(a.id, 'executive@example.com', { sendCode: async (_email, value) => { code = value; } });
    const token = store.verify(a.id, 'executive@example.com', code);
    now += 12 * 3_600_000; assert.throws(() => store.authorize(a.id, token), /sign in/);
    now += 7 * 86_400_000; assert.throws(() => store.get(a.id), /unavailable/);
  } finally { store.close(); }
});

test('email reservation prevents concurrent requests from sending repeated codes', async () => {
  const store = new ShareStore(':memory:'); let sends = 0;
  try {
    const a = store.create(fixture());
    const mailer = { sendCode: async () => { sends++; await new Promise(resolve => setTimeout(resolve, 10)); } };
    await Promise.all([store.challenge(a.id, 'executive@example.com', mailer), store.challenge(a.id, 'executive@example.com', mailer)]);
    assert.equal(sends, 1);
  } finally { store.close(); }
});

test('shared snapshots persist and never include memories outside the selected bundle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-share-persist-')); const file = join(dir, 'shares.sqlite');
  let store = new ShareStore(file); const a = store.create(fixture()); store.close(); store = new ShareStore(file);
  try { assert.equal(store.get(a.id).bundle.memories.length, 1); assert.equal(store.list()[0].count, 1); } finally { store.close(); }
});

test('source-excerpt answers do not call a cloud provider without share consent', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected cloud call'); });
  const store = new ShareStore(':memory:');
  try {
    const a = store.create(fixture()); const answer = await answerQuestion(a, 'Which database did we choose?');
    assert.equal(answer.mode, 'excerpts'); assert.equal(answer.sources.length, 1);
    const unrelated = await answerQuestion(a, 'Elephants and glaciers?'); assert.equal(unrelated.sources.length, 0);
  } finally { store.close(); }
});

test('reader HTTP flow hides all content until verification and supports revoke', async () => {
  const store = new ShareStore(':memory:'); let code = ''; const ownerToken = 'o'.repeat(40);
  const server = createShareServer(store, { ownerToken, publicUrl: 'http://127.0.0.1', mailer: { sendCode: async (_email, value) => { code = value; } } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, token = '') => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/shares', fixture())).status, 401);
    const created = await post('/api/shares', fixture(), ownerToken); assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await fetch(base + `/api/reader/${id}`)).status, 401);
    const page = await fetch(base + `/s/${id}`); assert.ok(!(await page.text()).includes('Synthetic executive brief'));
    await post(`/api/reader/${id}/code`, { email: 'executive@example.com' }); assert.match(code, /^\d{8}$/);
    const verified = await post(`/api/reader/${id}/verify`, { email: 'executive@example.com', code }); const { token } = await verified.json();
    const view = await fetch(base + `/api/reader/${id}`, { headers: { Authorization: 'Bearer ' + token } }); const snapshot = await view.json();
    assert.equal(snapshot.title, fixture().title); assert.equal(snapshot.recipients, undefined);
    assert.equal((await post('/api/shares', fixture(), token)).status, 401);
    const answer = await post(`/api/reader/${id}/ask`, { question: 'Which database?' }, token); assert.equal((await answer.json()).sources.length, 1);
    await post(`/api/shares/${id}/revoke`, {}, ownerToken);
    assert.equal((await fetch(base + `/api/reader/${id}`, { headers: { Authorization: 'Bearer ' + token } })).status, 401);
    const cross = await fetch(base + '/api/shares', { headers: { Authorization: 'Bearer ' + ownerToken, Origin: 'https://evil.example' } }); assert.equal(cross.status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); }
});

test('named pools resolve paths without exposing raw paths in routine commands', async () => {
  const prior = process.env.PENSIEVE_CONFIG_HOME; process.env.PENSIEVE_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'pensieve-pools-'));
  try {
    registerPool('sample', '/tmp/sample-pensieve', '/tmp/sample-project');
    assert.equal(resolvePool('sample').home, '/tmp/sample-pensieve'); assert.equal(resolvePool().name, 'sample');
    assert.throws(() => registerPool('sample', '/tmp/another-pool'), /another directory/);
    assert.throws(() => resolvePool('unknown'), /Unknown pool/);
  } finally { if (prior === undefined) delete process.env.PENSIEVE_CONFIG_HOME; else process.env.PENSIEVE_CONFIG_HOME = prior; }
});

test('generated answers send only selected evidence and reject invented citations', async t => {
  const oldKey = process.env.OPENAI_API_KEY, oldModel = process.env.PENSIEVE_ANSWER_MODEL;
  process.env.OPENAI_API_KEY = 'synthetic-test-key'; process.env.PENSIEVE_ANSWER_MODEL = 'synthetic-test-model';
  const store = new ShareStore(':memory:'); let invalidCitation = false;
  const selected = fixture().bundle.memories[0];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    const content = JSON.parse(payload.messages[1].content);
    assert.deepEqual(content.sources.map((s: { id: string }) => s.id), [selected.id]);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'SQLite was chosen for local storage.', citations: [invalidCitation ? 'invented-id' : selected.id] }) } }] }), { status: 200 });
  });
  try {
    const snapshot = store.create({ ...fixture(), cloudAllowed: true });
    assert.equal((await answerQuestion(snapshot, 'Which database?')).mode, 'generated');
    invalidCitation = true;
    await assert.rejects(answerQuestion(snapshot, 'Which database?'), /could not be grounded/);
  } finally {
    store.close();
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.PENSIEVE_ANSWER_MODEL; else process.env.PENSIEVE_ANSWER_MODEL = oldModel;
  }
});
