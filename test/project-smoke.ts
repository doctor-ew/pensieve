import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { discoverProject, readSession } from '../src/sessions.js';
import { Store } from '../src/store.js';
import { providerFromEnv } from '../src/embeddings.js';

// Local-only evaluation. Reports and imported conversation text stay outside the repo.
const project = resolve(process.argv[2] ?? '');
const home = process.argv[3];
if (!process.argv[2] || !home) throw new Error('Usage: tsx test/project-smoke.ts PROJECT_PATH PRIVATE_POOL_PATH');
if (process.env.PENSIEVE_PROVIDER && process.env.PENSIEVE_PROVIDER !== 'ollama') throw new Error('Project smoke test requires local Ollama embeddings');
await mkdir(home, { recursive: true, mode: 0o700 });
const store = new Store(join(home, 'memory.sqlite'));
const sources: Record<string, unknown> = {};
try {
  for (const source of ['codex', 'claude'] as const) {
    const root = join(homedir(), source === 'codex' ? '.codex/sessions' : '.claude/projects');
    let files: string[];
    try { files = await discoverProject(root, source, project); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; sources[source] = { discovered: 0, status: 'session root missing' }; continue; }
    // Bounded smoke test: newest lexically sorted three files per source, not whole history.
    const selected = files.slice(-3); let imported = 0, warnings = 0;
    for (const file of selected) {
      const parsed = await readSession(file, source);
      imported += store.add(parsed.memories); warnings += parsed.warnings.length;
      assert.equal(store.add(parsed.memories), 0, 'Reimport must be idempotent');
    }
    sources[source] = { discovered: files.length, selected, imported, warnings };
    process.stderr.write(`${source}: ${files.length} matching sessions; ${imported} imported memories from ${selected.length} files\n`);
  }
  const provider = providerFromEnv();
  process.stderr.write(`Indexing ${store.stats().memories} memories locally…\n`);
  const indexed = await store.index(provider);
  // Questions grounded in the Hack-Her-Thon brief; this is a retrieval inspection,
  // not an oracle asserting that the retrieved historical claims are true today.
  const queries = [
    'Why should the coach count reachable users instead of total addressable market?',
    'What is the maximum number of MVP features and how should success be measured?',
    'How must synthetic workshop evidence be separated from real fieldwork?',
  ];
  const results = [];
  for (const query of queries) {
    const hits = await store.search(query, provider, 5);
    assert.ok(hits.length > 0);
    assert.ok(hits.every(h => h.project === project && h.locator && h.session), 'Results must retain matching project provenance');
    results.push({ query, hits });
  }
  const report = { project, home, provider: provider.identity, sources, indexed, stats: store.stats(),
    provenanceChecks: 'passed', retrievalQuality: 'requires human inspection; not a truth or completeness certification', results };
  await writeFile(join(home, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ home, sources, indexed, report: join(home, 'report.json'), provenanceChecks: 'passed' }, null, 2) + '\n');
} finally { store.close(); }
