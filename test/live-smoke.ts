import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { providerFromEnv } from '../src/embeddings.js';
import { makeMemory } from '../src/sessions.js';

const home = await mkdtemp(join(tmpdir(), 'pensieve-live-'));
const store = new Store(join(home, 'memory.sqlite'));
try {
  store.add([
    'Synthetic example: We chose PostgreSQL because transactions keep account balances consistent.',
    'Synthetic example: The garden needs watering every morning and fresh compost in spring.',
    'Synthetic example: Our website uses a dark green palette and serif headlines.',
  ].map(text => makeMemory({ text, source: 'manual', session: 'synthetic-live-smoke', role: 'user', timestamp: '', locator: 'synthetic fixture', project: 'Pensieve demo' })));
  const provider = providerFromEnv();
  assert.equal(await store.index(provider), 3);
  const results = await store.search('Why did we pick a relational database for financial correctness?', provider);
  assert.match(results[0].text, /PostgreSQL/);
  const evidence = { home, provider: provider.identity, results: results.map(x => ({ text: x.text, score: x.score })), passed: true };
  await writeFile(join(home, 'evidence.json'), JSON.stringify(evidence, null, 2));
  process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
} finally { store.close(); }
