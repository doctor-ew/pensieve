import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { TeamStore } from '../src/team-store.js';
import { createTeamServer } from '../src/team-server.js';
import { ShareStore } from '../src/executive.js';
import { makeMemory } from '../src/sessions.js';
import type { EmbeddingProvider } from '../src/types.js';

const memory = (text: string) => makeMemory({ text, source: 'manual', role: 'user', project: '/synthetic/project', session: 'synthetic', timestamp: '2026-01-01T00:00:00Z', locator: 'synthetic-fixture' });
const vectors: EmbeddingProvider = { identity: 'test:team-server', embed: async texts => texts.map(text => text.includes('database') ? [1, 0] : [0, 1]) };

async function fixture(withProvider = true) {
  const socket = createNetServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address(); assert.ok(address && typeof address !== 'string');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const store = new TeamStore(':memory:'); const shares = new ShareStore(':memory:'); const ownerToken = 'operator-'.repeat(8);
  const server = createTeamServer(store, { ownerToken, publicUrl: base, provider: withProvider ? vectors : undefined, shareStore: shares });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const request = (path: string, token = '', body?: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const close = async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); shares.close(); };
  return { base, store, shares, ownerToken, request, close };
}

test('team server invites distinct creators without exposing operator credentials or implicit pool access', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/team/admin/users', '', { name: 'Alice' })).status, 401);
    const invite = await f.request('/api/team/admin/users', f.ownerToken, { name: 'Alice' }); assert.equal(invite.status, 201);
    const alice = await invite.json(); const bob = await (await f.request('/api/team/admin/users', f.ownerToken, { name: 'Bob' })).json();
    assert.notEqual(alice.token, bob.token); assert.notEqual(alice.token, f.ownerToken);
    assert.equal((await f.request('/api/team/me', f.ownerToken)).status, 401);
    const me = await (await f.request('/api/team/me', alice.token)).json();
    assert.equal(me.user.id, alice.user.id); assert.equal(me.token, undefined);
    const page = await (await f.request('/')).text(); assert.ok(page.includes('Create')); assert.ok(!page.includes(f.ownerToken));
    assert.equal((await f.request(`/api/team/admin/users/${alice.user.id}/revoke`, bob.token, {})).status, 401);
    assert.equal((await f.request(`/api/team/admin/users/${alice.user.id}/revoke`, f.ownerToken, {})).status, 200);
    assert.equal((await f.request('/api/team/me', alice.token)).status, 401);
    assert.equal((await f.request('/api/team/me', bob.token)).status, 200);
  } finally { await f.close(); }
});

test('pool API enforces cross-user isolation and reader versus writer permissions', async () => {
  const f = await fixture();
  try {
    const alice = f.store.createUser('Alice'); const bob = f.store.createUser('Bob'); const outsider = f.store.createUser('Outsider');
    const privatePool = await (await f.request('/api/team/pools', alice.token, { name: 'Private reasoning', visibility: 'private' })).json();
    const secret = memory('Synthetic private database reasoning <script>attack()</script>');
    assert.equal((await f.request(`/api/team/pools/${privatePool.pool.id}/memories`, alice.token, { memories: [secret] })).status, 201);
    assert.deepEqual((await (await f.request('/api/team/pools', bob.token)).json()).pools, []);
    for (const [suffix, input] of [
      ['', undefined], ['/memories', undefined], ['/export', { ids: [secret.id] }], ['/search', { query: 'database' }], ['/memories', { memories: [secret], actorId: alice.user.id }],
    ] as const) {
      const response = await f.request(`/api/team/pools/${privatePool.pool.id}${suffix}`, bob.token, input);
      assert.equal(response.status, 404); assert.ok(!(await response.text()).includes(secret.text));
    }
    assert.equal((await f.request(`/api/team/pools/${privatePool.pool.id}/members`, alice.token, { userId: bob.user.id, role: 'reader' })).status, 403);
    const shared = await (await f.request('/api/team/pools', alice.token, { name: 'Shared build', visibility: 'shared' })).json(); const id = shared.pool.id;
    assert.equal((await f.request(`/api/team/pools/${id}/members`, alice.token, { userId: bob.user.id, role: 'reader' })).status, 200);
    assert.equal((await f.request(`/api/team/pools/${id}/memories`, bob.token)).status, 200);
    assert.equal((await f.request(`/api/team/pools/${id}/memories`, bob.token, { memories: [secret] })).status, 403);
    assert.equal((await f.request(`/api/team/pools/${id}/members`, bob.token, { userId: outsider.user.id, role: 'writer' })).status, 403);
    assert.equal((await f.request(`/api/team/pools/${id}/members`, alice.token, { userId: bob.user.id, role: 'writer' })).status, 200);
    assert.equal((await f.request(`/api/team/pools/${id}/memories`, bob.token, { memories: [secret] })).status, 201);
    const saved = await (await f.request(`/api/team/pools/${id}/memories`, alice.token)).json();
    assert.equal(saved.memories[0].contributorId, bob.user.id); assert.equal(saved.memories[0].memory.text, secret.text);
    assert.equal((await f.request(`/api/team/pools/${id}/index`, alice.token, {})).status, 200);
    const results = await (await f.request(`/api/team/pools/${id}/search`, bob.token, { query: 'database' })).json(); assert.equal(results.hits[0].id, secret.id);
  } finally { await f.close(); }
});

test('curated team sharing preserves invitation reader/download access and excludes unselected memories', async () => {
  const f = await fixture();
  try {
    const alice = f.store.createUser('Alice'); const pool = f.store.createPool(alice.user.id, 'Build', 'shared');
    const selected = memory('Synthetic selected decision'); const excluded = memory('Synthetic second audience only');
    f.store.putMemory(alice.user.id, pool.id, selected); f.store.putMemory(alice.user.id, pool.id, excluded);
    const response = await f.request(`/api/team/pools/${pool.id}/shares`, alice.token, { ids: [selected.id], title: 'Selected idea', brief: 'Reviewed synthetic decision', recipients: ['developer-a@example.com'], days: 7 });
    assert.equal(response.status, 201); const share = await response.json();
    const invitation = new URL(share.invitations[0].url); const token = invitation.hash.slice(1);
    const reader = await f.request(`/api/reader/${share.id}`, token); assert.equal(reader.status, 200);
    const readerBody = await reader.json(); assert.deepEqual(readerBody.memories.map((m: { id: string }) => m.id), [selected.id]);
    const download = await f.request(`/api/reader/${share.id}/download`, token); assert.equal(download.status, 200);
    const text = await download.text(); assert.ok(text.includes(selected.text)); assert.ok(!text.includes(excluded.text)); assert.ok(!text.includes(alice.token)); assert.ok(!text.includes(f.ownerToken));
    assert.equal((await f.request(`/api/team/pools/${pool.id}/memories`, token)).status, 401);
  } finally { await f.close(); }
});

test('browser sessions use protected cookies, reject cross-origin mutation, and recheck revocation', async () => {
  const f = await fixture(false);
  try {
    const alice = f.store.createUser('Alice');
    assert.equal((await f.request('/api/team/session', '', { token: alice.token }, { Origin: 'https://evil.example' })).status, 403);
    const login = await f.request('/api/team/session', '', { token: alice.token }, { Origin: f.base }); assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!; assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i); assert.ok(!cookie.includes(alice.token));
    const session = cookie.split(';')[0];
    assert.equal((await f.request('/api/team/me', '', undefined, { Cookie: session })).status, 200);
    assert.equal((await f.request('/api/team/pools', '', { name: 'CSRF attempt', visibility: 'shared' }, { Cookie: session, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.request('/api/team/pools', '', { name: 'No origin', visibility: 'shared' }, { Cookie: session })).status, 403);
    const pool = f.store.createPool(alice.user.id, 'No model', 'shared');
    const index = await f.request(`/api/team/pools/${pool.id}/index`, alice.token, {}); assert.equal(index.status, 503); assert.match(await index.text(), /embedding|provider/i);
    f.store.revokeUser(alice.user.id);
    assert.equal((await f.request('/api/team/me', '', undefined, { Cookie: session })).status, 401);
  } finally { await f.close(); }
});

test('batch capture rejects a conflicting ID without retaining earlier writes', async () => {
  const f = await fixture();
  try {
    const alice = f.store.createUser('Alice'); const pool = f.store.createPool(alice.user.id, 'Atomic', 'shared'); const original = memory('Synthetic original'); f.store.putMemory(alice.user.id, pool.id, original);
    const fresh = memory('Synthetic should roll back'); const conflict = { ...original, text: 'Synthetic changed body' };
    const response = await f.request(`/api/team/pools/${pool.id}/memories`, alice.token, { memories: [fresh, conflict] }); assert.equal(response.status, 400);
    assert.deepEqual(f.store.listMemories(alice.user.id, pool.id).map(row => row.memory.id), [original.id]);
  } finally { await f.close(); }
});

test('curated share management is scoped to its pool and creator or owner', async () => {
  const f = await fixture();
  try {
    const owner = f.store.createUser('Owner'); const writer = f.store.createUser('Writer'); const peer = f.store.createUser('Peer');
    const pool = f.store.createPool(owner.user.id, 'Synthetic handoff', 'shared');
    f.store.grantMember(owner.user.id, pool.id, writer.user.id, 'writer'); f.store.grantMember(owner.user.id, pool.id, peer.user.id, 'writer');
    const m = memory('Synthetic revocable handoff'); f.store.putMemory(writer.user.id, pool.id, m);
    const created = await f.request(`/api/team/pools/${pool.id}/shares`, writer.token, { ids: [m.id], title: 'Handoff', brief: 'Synthetic', recipients: ['dev@example.com'], days: 7 });
    assert.equal(created.status, 201); const share = await created.json();
    const listed = await (await f.request(`/api/team/pools/${pool.id}/shares`, writer.token)).json();
    assert.equal(listed.shares[0].id, share.id); assert.ok(!JSON.stringify(listed).includes(new URL(share.invitations[0].url).hash.slice(1)));
    const revokePath = `/api/team/pools/${pool.id}/shares/${share.id}/revoke`;
    assert.equal((await f.request(revokePath, peer.token, {})).status, 404);
    assert.equal((await f.request('/api/shares', writer.token)).status, 404);
    const foreign = f.store.createPool(peer.user.id, 'Other pool', 'shared');
    assert.equal((await f.request(`/api/team/pools/${foreign.id}/shares/${share.id}/revoke`, peer.token, {})).status, 404);
    assert.equal((await f.request(revokePath, owner.token, {})).status, 200);
    const token = new URL(share.invitations[0].url).hash.slice(1);
    assert.notEqual((await f.request(`/api/reader/${share.id}`, token)).status, 200);
  } finally { await f.close(); }
});

test('invalid host and malformed input cannot mutate; logout invalidates only its browser session', async () => {
  const f = await fixture();
  try {
    const alice = f.store.createUser('Alice');
    const foreignHost = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(f.base + '/api/team/pools', { headers: { Host: 'evil.example', Authorization: 'Bearer ' + alice.token } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(foreignHost, 403);
    const malformed = await fetch(f.base + '/api/team/pools', { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400); assert.deepEqual(f.store.listPools(alice.user.id), []);
    const login = await f.request('/api/team/session', '', { token: alice.token }, { Origin: f.base });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await f.request('/api/team/logout', '', {}, { Cookie: cookie, Origin: f.base })).status, 200);
    assert.equal((await f.request('/api/team/me', '', undefined, { Cookie: cookie })).status, 401);
    assert.equal((await f.request('/api/team/me', alice.token)).status, 200);
  } finally { await f.close(); }
});

test('pool policy APIs persist exact scoped overrides and deny reader changes', async () => {
  const f = await fixture();
  try {
    const owner = f.store.createUser('Owner'); const reader = f.store.createUser('Reader'); const pool = f.store.createPool(owner.user.id, 'Policy', 'shared');
    f.store.grantMember(owner.user.id, pool.id, reader.user.id, 'reader');
    const path = `/api/team/pools/${pool.id}/policy`;
    const policy = { destination: 'shared', pool: pool.id, autoSave: true };
    assert.equal((await f.request(path, reader.token, { scope: 'team', key: '', policy })).status, 403);
    assert.equal((await f.request(path, owner.token, { scope: 'team', key: '', policy })).status, 200);
    assert.equal((await f.request(path, owner.token, { scope: 'repository', key: '/synthetic/repo', policy: { destination: 'off' } })).status, 200);
    const scoped = await (await f.request(path + '?repository=%2Fsynthetic%2Frepo', owner.token)).json();
    assert.equal(scoped.effective.destination, 'off'); assert.equal(scoped.effective.pool, undefined);
    const other = await (await f.request(path + '?repository=%2Fsynthetic%2Frepo-other', owner.token)).json();
    assert.deepEqual(other.effective, policy);
  } finally { await f.close(); }
});

test('capture obeys off, private and shared-target policies; reader cannot issue invitations', async () => {
  const f = await fixture();
  try {
    const alice = f.store.createUser('Alice'); const reader = f.store.createUser('Reader');
    const pool = f.store.createPool(alice.user.id, 'Policy target', 'shared'); const other = f.store.createPool(alice.user.id, 'Other target', 'shared');
    const m = memory('Synthetic policy controlled capture');
    for (const policy of [{ destination: 'off' }, { destination: 'private' }, { destination: 'shared', pool: other.id }]) {
      f.store.setPolicy(alice.user.id, pool.id, 'team', '', policy);
      assert.equal((await f.request(`/api/team/pools/${pool.id}/memories`, alice.token, { memories: [m] })).status, 409);
      assert.deepEqual(f.store.listMemories(alice.user.id, pool.id), []);
    }
    f.store.setPolicy(alice.user.id, pool.id, 'team', '', { destination: 'shared', pool: pool.id });
    assert.equal((await f.request(`/api/team/pools/${pool.id}/memories`, alice.token, { memories: [m] })).status, 201);
    f.store.grantMember(alice.user.id, pool.id, reader.user.id, 'reader');
    assert.equal((await f.request(`/api/team/pools/${pool.id}/shares`, reader.token, { ids: [m.id], title: 'Forbidden', brief: 'Synthetic', recipients: ['dev@example.com'], days: 7 })).status, 403);
    assert.equal(f.shares.list().length, 0);
  } finally { await f.close(); }
});
