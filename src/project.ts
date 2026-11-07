import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverProject, makeMemory, readSession } from './sessions.js';
import type { Store } from './store.js';

// Project material and full exact-cwd conversation history, never a smoke-test sample.
export async function importProject(store: Store, directory: string) {
  const project = resolve(directory);
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: project, encoding: 'utf8', maxBuffer: 10_000_000 }).split('\0').filter(p => p && !p.startsWith('.'));
  let documents = 0, sessions = 0, imported = 0;
  const warnings: string[] = [];
  for (const file of files) {
    const text = await readFile(join(project, file), 'utf8');
    if (!text.trim()) continue;
    documents++;
    for (let offset = 0; offset < text.length; offset += 2200) {
      const line = text.slice(0, offset).split('\n').length;
      imported += store.add([makeMemory({ text: `Project document: ${file}\n\n${text.slice(offset, offset + 2200)}`, source: 'manual', role: 'user', project, session: `repository:${revision}`, timestamp: '', locator: `${file}:L${line}:C${offset + 1}` })]);
    }
  }
  for (const source of ['codex', 'claude'] as const) {
    const root = join(homedir(), source === 'codex' ? '.codex/sessions' : '.claude/projects');
    let paths: string[];
    try { paths = await discoverProject(root, source, project); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    for (const path of paths) {
      const parsed = await readSession(path, source);
      imported += store.add(parsed.memories); sessions++;
      warnings.push(...parsed.warnings.map(w => `${path}: ${w}`));
    }
  }
  return { project, revision, documents, sessions, imported, warnings };
}
