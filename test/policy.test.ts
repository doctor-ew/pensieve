import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePolicyToml, resolvePolicy, validateCapturePolicy } from '../src/policy.js';

test('capture defaults private and narrower policy replaces shared destination', () => {
  assert.deepEqual(resolvePolicy({}), { destination: 'private', autoSave: false });
  const team = { destination: 'shared', pool: 'team-alpha', autoSave: true } as const;
  assert.deepEqual(resolvePolicy({ team }), team);
  assert.deepEqual(resolvePolicy({ team, repository: { destination: 'private' } }), { destination: 'private', autoSave: false });
  assert.deepEqual(resolvePolicy({ team, repository: { destination: 'private' }, conversation: { destination: 'shared', pool: 'project-beta', autoSave: true } }), { destination: 'shared', pool: 'project-beta', autoSave: true });
  assert.deepEqual(resolvePolicy({ team, conversation: { destination: 'off' } }), { destination: 'off', autoSave: false });
});

test('routing fails closed for invalid declarations even when another layer overrides them', () => {
  for (const value of [null, [], {}, { destination: 'public' }, { destination: 'shared' }, { destination: 'shared', pool: '' }, { destination: 'shared', pool: '../escape' }, { destination: 'private', pool: 'stale-team' }, { destination: 'off', autoSave: true }, { destination: 'private', autoSave: 'yes' }, { destination: 'private', publish: true }]) {
    assert.throws(() => validateCapturePolicy(value), /policy|destination|pool|autoSave|field/i);
  }
  assert.throws(() => resolvePolicy({ team: { destination: 'shared' }, conversation: { destination: 'private' } }), /pool/i);
});

test('TOML policy parser supports only declared scopes and catches malformed input', () => {
  const layers = parsePolicyToml('[team]\ndestination = "shared"\npool = "team-alpha"\nautoSave = true\n[repository]\ndestination = "private"\n');
  assert.deepEqual(resolvePolicy(layers), { destination: 'private', autoSave: false });
  assert.throws(() => parsePolicyToml('[team\ndestination = "shared"'), /./);
  assert.throws(() => parsePolicyToml('[team]\ndestination="private"\nsecret="do-not-ignore"'), /field|policy/i);
  assert.throws(() => parsePolicyToml('[unexpected]\ndestination="shared"'), /scope|field|policy/i);
});
