import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TeamStore } from '../src/team-store.js';
import { makeMemory } from '../src/sessions.js';
import type { EmbeddingProvider } from '../src/types.js';

const memory = (text: string) => makeMemory({ text, source: 'manual', role: 'user', session: 'synthetic-test', timestamp: '2026-01-01', locator: 'synthetic-test:L1', project: '/original/machine/project' });
const provider: EmbeddingProvider = { identity: 'synthetic:two-dimensional', embed: async texts => texts.map(text => text.includes('database') ? [1, 0] : [0, 1]) };

test('private pools and unknown pools deny reads, writes, exports and search without invoking a provider', async () => {
  const store = new TeamStore(':memory:'); let calls = 0;
  const sentinel: EmbeddingProvider = { identity: 'must-not-call', embed: async () => { calls++; return [[1, 0]]; } };
  try {
    const alice = store.createUser('Alice'), bob = store.createUser('Bob');
    assert.deepEqual(store.authenticate(alice.token), alice.user);
    assert.throws(() => store.authenticate('not-a-token'), /unauthorized|authentication/i);
    const pool = store.createPool(alice.user.id, 'Private idea', 'private');
    const record = memory('Private database decision'); store.putMemory(alice.user.id, pool.id, record);
    assert.equal(store.listPools(bob.user.id).length, 0);
    for (const poolId of [pool.id, 'does-not-exist']) {
      assert.throws(() => store.getPool(bob.user.id, poolId), /unavailable|forbidden|authorized/i);
      assert.throws(() => store.listMemories(bob.user.id, poolId), /unavailable|forbidden|authorized/i);
      assert.throws(() => store.getMemories(bob.user.id, poolId, [record.id]), /unavailable|forbidden|authorized/i);
      assert.throws(() => store.exportBundle(bob.user.id, poolId, [record.id]), /unavailable|forbidden|authorized/i);
      assert.throws(() => store.putMemory(bob.user.id, poolId, record), /unavailable|forbidden|authorized/i);
      await assert.rejects(store.index(bob.user.id, poolId, sentinel), /unavailable|forbidden|authorized/i);
      await assert.rejects(store.search(bob.user.id, poolId, 'database', sentinel), /unavailable|forbidden|authorized/i);
    }
    assert.equal(calls, 0);
    assert.throws(() => store.grantMember(alice.user.id, pool.id, bob.user.id, 'reader'), /private/i);
  } finally { store.close(); }
});

test('shared membership assigns owner/writer/reader capabilities and trusted contribution authorship', () => {
  const store = new TeamStore(':memory:');
  try {
    const alice = store.createUser('Alice'), bob = store.createUser('Bob'), carol = store.createUser('Carol');
    const pool = store.createPool(alice.user.id, 'Team plan', 'shared');
    store.grantMember(alice.user.id, pool.id, bob.user.id, 'writer');
    store.grantMember(alice.user.id, pool.id, carol.user.id, 'reader');
    assert.equal(store.getPool(bob.user.id, pool.id).role, 'writer');
    assert.equal(store.listPools(carol.user.id)[0].role, 'reader');
    const record = memory('Synthetic engineering discovery'); store.putMemory(bob.user.id, pool.id, record);
    const listed = store.listMemories(carol.user.id, pool.id);
    assert.equal(listed[0].contributorId, bob.user.id); assert.deepEqual(listed[0].memory, record);
    assert.throws(() => store.putMemory(carol.user.id, pool.id, memory('reader mutation')), /forbidden|authorized|writer/i);
    assert.throws(() => store.grantMember(bob.user.id, pool.id, carol.user.id, 'writer'), /forbidden|owner|authorized/i);
    assert.throws(() => store.grantMember(alice.user.id, pool.id, alice.user.id, 'reader'), /owner/i);
    assert.equal(store.getPool(alice.user.id, pool.id).role, 'owner');
  } finally { store.close(); }
});

test('revoked identities lose all access and tokens are never stored as plaintext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-team-')); const file = join(dir, 'team.sqlite');
  const store = new TeamStore(file);
  const alice = store.createUser('Alice'), bob = store.createUser('Bob');
  const pool = store.createPool(alice.user.id, 'Team', 'shared'); store.grantMember(alice.user.id, pool.id, bob.user.id, 'writer');
  store.revokeUser(bob.user.id);
  assert.throws(() => store.authenticate(bob.token), /unauthorized|authentication/i);
  assert.throws(() => store.listPools(bob.user.id), /unauthorized|authentication/i);
  assert.throws(() => store.putMemory(bob.user.id, pool.id, memory('revoked write')), /unauthorized|authentication/i);
  assert.deepEqual(store.authenticate(alice.token), alice.user); store.close();
  assert.equal((await readFile(file)).includes(Buffer.from(alice.token)), false);
  assert.equal((await readFile(file)).includes(Buffer.from(bob.token)), false);
});

test('idempotent contributions and conflicting batches are atomic; selected export excludes other memories', () => {
  const store = new TeamStore(':memory:');
  try {
    const { user } = store.createUser('Alice'); const pool = store.createPool(user.id, 'Team', 'shared');
    const first = memory('Selected idea'), second = memory('Do not share this');
    assert.equal(store.putMemory(user.id, pool.id, first).created, true);
    assert.equal(store.putMemory(user.id, pool.id, first).created, false);
    assert.throws(() => store.putMemories(user.id, pool.id, [second, { ...first, text: 'conflicting content' }]), /conflict/i);
    assert.equal(store.listMemories(user.id, pool.id).length, 1);
    store.putMemory(user.id, pool.id, second);
    assert.throws(() => store.exportBundle(user.id, pool.id, []), /select/i);
    const bundle = store.exportBundle(user.id, pool.id, [first.id]);
    assert.deepEqual(bundle.memories, [first]); assert.ok(!JSON.stringify(bundle).includes(second.text));
  } finally { store.close(); }
});

test('vector recall isolates pools and model identities and rejects changed dimensions', async () => {
  const store = new TeamStore(':memory:');
  try {
    const { user } = store.createUser('Alice'); const a = store.createPool(user.id, 'A', 'private'), b = store.createPool(user.id, 'B', 'private');
    const aMemory = memory('database choice in A'), bMemory = memory('database private B');
    store.putMemory(user.id, a.id, aMemory); store.putMemory(user.id, a.id, memory('design colors')); store.putMemory(user.id, b.id, bMemory);
    assert.equal(await store.index(user.id, a.id, provider), 2);
    assert.equal(await store.index(user.id, a.id, provider), 0);
    assert.equal((await store.search(user.id, a.id, 'database', provider))[0].id, aMemory.id);
    assert.ok((await store.search(user.id, a.id, 'database', provider)).every(hit => hit.id !== bMemory.id));
    await assert.rejects(store.search(user.id, b.id, 'database', provider), /index/i);
    await assert.rejects(store.search(user.id, a.id, 'database', { ...provider, identity: 'other' }), /index/i);
    store.putMemory(user.id, a.id, memory('new database decision'));
    await assert.rejects(store.index(user.id, a.id, { ...provider, embed: async texts => texts.map(() => [1, 0, 0]) }), /dimension/i);
  } finally { store.close(); }
});

test('revocation during embedding cannot complete a write or disclose query results', async () => {
  const store = new TeamStore(':memory:');
  try {
    const { user } = store.createUser('Alice'); const pool = store.createPool(user.id, 'A', 'private'); store.putMemory(user.id, pool.id, memory('database'));
    let finish: ((vectors: number[][]) => void) | undefined;
    const pending: EmbeddingProvider = { identity: 'pending', embed: () => new Promise(resolve => { finish = resolve; }) };
    const indexing = store.index(user.id, pool.id, pending); store.revokeUser(user.id); finish!([[1, 0]]);
    await assert.rejects(indexing, /unauthorized|authentication/i);
  } finally { store.close(); }
});

test('portable authorship remains unverified on import and never grants contributor access', () => {
  const store = new TeamStore(':memory:');
  try {
    const a = store.createUser('Alice'), b = store.createUser('Bob');
    const source = store.createPool(a.user.id, 'Source', 'private'), target = store.createPool(b.user.id, 'Target', 'private');
    const m = memory('portable decision'); store.putMemory(a.user.id, source.id, m);
    const bundle = store.exportBundle(a.user.id, source.id, [m.id]);
    assert.equal(bundle.provenance![0].verification, 'source-server');
    store.putMemories(b.user.id, target.id, bundle.memories, bundle.provenance);
    const exported = store.exportBundle(b.user.id, target.id, [m.id]);
    assert.ok(exported.provenance!.some(p => p.contributorId === a.user.id && p.verification === 'unverified-import'));
    assert.ok(exported.provenance!.some(p => p.contributorId === b.user.id && p.verification === 'source-server'));
    assert.throws(() => store.getPool(a.user.id, target.id));
  } finally { store.close(); }
});

test('share registry is durable and only creator or owner can revoke within their pool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pensieve-shares-')); const path = join(dir, 'team.sqlite');
  let store = new TeamStore(path);
  const a = store.createUser('Alice'), b = store.createUser('Bob'), c = store.createUser('Carol');
  const pool = store.createPool(a.user.id, 'Team', 'shared');
  store.grantMember(a.user.id, pool.id, b.user.id, 'writer'); store.grantMember(a.user.id, pool.id, c.user.id, 'writer');
  const m = memory('share me'); store.putMemory(b.user.id, pool.id, m);
  store.recordShare(b.user.id, pool.id, 'synthetic-share', [m.id]); store.close(); store = new TeamStore(path);
  try {
    assert.equal(store.listShares(a.user.id, pool.id)[0].creatorId, b.user.id);
    store.authorizeShareRevocation(b.user.id, pool.id, 'synthetic-share');
    store.authorizeShareRevocation(a.user.id, pool.id, 'synthetic-share');
    assert.throws(() => store.authorizeShareRevocation(c.user.id, pool.id, 'synthetic-share'));
    assert.throws(() => store.recordShare(c.user.id, pool.id, 'synthetic-share', [m.id]));
  } finally { store.close(); }
});

test('external vector backend cannot inject another pool memory and failed upserts stay retryable', async () => {
  let fail = true, upserts = 0; const resultIds: string[] = [];
  const backend = { identity: 'synthetic-backend',
    upsert: async () => { upserts++; if (fail) throw new Error('synthetic unavailable'); },
    query: async () => resultIds.map(id => ({ id, score: 0.9 })) };
  const store = new TeamStore(':memory:', backend);
  try {
    const { user } = store.createUser('Alice'); const a = store.createPool(user.id, 'A', 'private'), b = store.createPool(user.id, 'B', 'private');
    const one = memory('database A'), two = memory('database B');
    store.putMemory(user.id, a.id, one); store.putMemory(user.id, b.id, two);
    await assert.rejects(store.index(user.id, a.id, provider), /unavailable/);
    fail = false; assert.equal(await store.index(user.id, a.id, provider), 1); assert.equal(upserts, 2);
    resultIds.push(two.id, one.id, 'nonexistent');
    assert.deepEqual((await store.search(user.id, a.id, 'database', provider)).map(hit => hit.id), [one.id]);
  } finally { store.close(); }
});

test('policy settings persist exact scope keys separately from memory and actor authorization', () => {
  const store = new TeamStore(':memory:');
  try {
    const a = store.createUser('Alice'), b = store.createUser('Bob'); const pool = store.createPool(a.user.id, 'Team', 'shared');
    store.grantMember(a.user.id, pool.id, b.user.id, 'reader');
    store.setPolicy(a.user.id, pool.id, 'team', '', { destination: 'shared', pool: pool.id, autoSave: true });
    store.setPolicy(a.user.id, pool.id, 'repository', '/repo/exact', { destination: 'off' });
    assert.equal(store.getPolicies(a.user.id, pool.id, '/repo/exact').repository!.destination, 'off');
    assert.equal(store.getPolicies(a.user.id, pool.id, '/repo/exact-extra').repository, undefined);
    assert.deepEqual(store.getPolicies(b.user.id, pool.id, '/repo/exact'), {team:{destination:'shared',pool:pool.id,autoSave:true}});
    assert.throws(() => store.setPolicy(b.user.id, pool.id, 'team', '', { destination: 'private' }));
    const m = memory('reader share denied'); store.putMemory(a.user.id, pool.id, m);
    assert.throws(() => store.recordShare(b.user.id, pool.id, 'denied-share', [m.id]));
    store.revokeUser(a.user.id); assert.throws(() => store.getUser(a.user.id));
  } finally { store.close(); }
});

test('query revocation during provider work returns no content', async () => {
  const store = new TeamStore(':memory:');
  try {
    const {user} = store.createUser('Alice'); const pool = store.createPool(user.id,'Private','private');
    store.putMemory(user.id,pool.id,memory('database secret')); await store.index(user.id,pool.id,provider);
    let finish!: (v:number[][]) => void;
    const pending = store.search(user.id,pool.id,'database',{identity:provider.identity,embed:()=>new Promise(resolve=>{finish=resolve;})});
    store.revokeUser(user.id); finish([[1,0]]); await assert.rejects(pending,/unauthorized/i);
  } finally {store.close();}
});

test('failed later vector batch leaves no partial index and reader never invokes provider', async () => {
  const store = new TeamStore(':memory:'); let calls=0;
  const invalid: EmbeddingProvider = {identity:'multi-batch',embed:async texts=>{calls++;return texts.map(()=>calls===1?[1,0]:[NaN,0]);}};
  try {
    const a=store.createUser('Alice'), b=store.createUser('Bob'); const pool=store.createPool(a.user.id,'Shared','shared');
    store.grantMember(a.user.id,pool.id,b.user.id,'reader'); store.putMemories(a.user.id,pool.id,Array.from({length:17},(_,i)=>memory(`database ${i}`)));
    await assert.rejects(store.index(b.user.id,pool.id,invalid)); assert.equal(calls,0);
    await assert.rejects(store.index(a.user.id,pool.id,invalid));
    await assert.rejects(store.search(a.user.id,pool.id,'database',invalid),/index/i);
    assert.equal(await store.index(a.user.id,pool.id,{...provider,identity:invalid.identity}),17);
  } finally {store.close();}
});


test('pool team default applies to writers who can only change personal overrides', () => {
  const store = new TeamStore(':memory:');
  try {
    const a = store.createUser('Alice'), b = store.createUser('Bob'); const pool = store.createPool(a.user.id,'Shared','shared');
    store.grantMember(a.user.id,pool.id,b.user.id,'writer');
    store.setPolicy(a.user.id,pool.id,'team','',{destination:'shared',pool:pool.id,autoSave:true});
    assert.equal(store.getPolicies(b.user.id,pool.id).team!.pool,pool.id);
    assert.throws(()=>store.setPolicy(b.user.id,pool.id,'team','',{destination:'off'}),/owner/i);
    store.setPolicy(b.user.id,pool.id,'repository','/personal',{destination:'private'});
    assert.equal(store.getPolicies(b.user.id,pool.id,'/personal').repository!.destination,'private');
    assert.equal(store.getPolicies(a.user.id,pool.id,'/personal').repository,undefined);
  } finally {store.close();}
});

test('downgraded share creator cannot list or revoke hosted invitations', () => {
  const store=new TeamStore(':memory:');
  try {
    const a=store.createUser('Owner'),b=store.createUser('Former writer');const p=store.createPool(a.user.id,'Shared','shared');
    store.grantMember(a.user.id,p.id,b.user.id,'writer'); const m=memory('synthetic share');store.putMemory(b.user.id,p.id,m);store.recordShare(b.user.id,p.id,'share-created-before-downgrade',[m.id]);
    store.grantMember(a.user.id,p.id,b.user.id,'reader');
    assert.throws(()=>store.listShares(b.user.id,p.id),/writer/i);
    assert.throws(()=>store.authorizeShareRevocation(b.user.id,p.id,'share-created-before-downgrade'),/writer/i);
    store.authorizeShareRevocation(a.user.id,p.id,'share-created-before-downgrade');
    assert.deepEqual(store.exportBundle(b.user.id,p.id,[m.id]).memories,[m]);
  } finally {store.close();}
});

test('large accumulated pool chunks backend indexing and commits no receipts until all chunks succeed', async () => {
  const lengths:number[]=[];let failLast=true;
  const backend={identity:'bounded-synthetic',upsert:async(_pool:string,_model:string,records:{id:string;vector:number[]}[])=>{
    lengths.push(records.length);assert.ok(records.length<=10000);if(failLast&&records.length===1)throw new Error('last chunk unavailable');
  },query:async()=>[]};
  const store=new TeamStore(':memory:',backend);
  try {
    const {user}=store.createUser('Owner');const p=store.createPool(user.id,'Large synthetic','private');
    store.putMemories(user.id,p.id,Array.from({length:10000},(_,i)=>memory(`synthetic database record ${i}`)));
    store.putMemory(user.id,p.id,memory('synthetic database record final'));
    await assert.rejects(store.index(user.id,p.id,provider),/last chunk unavailable/);
    await assert.rejects(store.search(user.id,p.id,'database',provider),/index/i);
    assert.deepEqual(lengths,[10000,1]);failLast=false;
    assert.equal(await store.index(user.id,p.id,provider),10001);
    assert.deepEqual(lengths,[10000,1,10000,1]);
  } finally {store.close();}
});
