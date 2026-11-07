import assert from 'node:assert/strict';
import { shareConfig, shareRequest } from '../src/share-client.js';
import { makeMemory } from '../src/sessions.js';

const config = shareConfig(); if (!config.url) throw new Error('Connect the sharing service first');
const shared = await shareRequest('', { title: 'Synthetic deployment smoke test', brief: 'A synthetic database decision used only to verify sharing.', recipients: ['pensieve-smoke@example.com'], days: 1, cloudAllowed: false, accessMode: 'invitation-link', bundle: { format: 'pensieve/v1', createdAt: '', memories: [makeMemory({ text: 'Synthetic: choose SQLite for local database storage.', source: 'manual', session: 'synthetic-remote-smoke', role: 'user', timestamp: '', locator: 'synthetic fixture', project: '' })] } }) as { id: string; invitations: { url: string; mailto: string }[] };
const invitation = shared.invitations[0]; const token = new URL(invitation.url).hash.slice(1);
const endpoint = new URL(`/api/reader/${shared.id}`, config.url);
try {
  assert.ok(decodeURIComponent(invitation.mailto).includes(invitation.url));
  assert.equal((await fetch(endpoint)).status, 401);
  const read = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(read.status, 200); assert.equal((await read.json()).memories.length, 1);
  const answer = await fetch(new URL(endpoint + '/ask'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Which database was chosen?' }) });
  assert.equal(answer.status, 200); assert.equal((await answer.json()).sources.length, 1);
} finally { await shareRequest(`/${shared.id}/revoke`, {}); }
assert.equal((await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
process.stdout.write(JSON.stringify({ service: config.url, shareId: shared.id, result: 'passed', checks: ['private invitation', 'email draft contains invitation', 'unauthenticated access denied', 'reader content', 'source-backed question', 'revoked access denied'], synthetic: true, emailSent: false }) + '\n');
