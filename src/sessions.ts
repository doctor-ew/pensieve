import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { basename, join } from 'node:path';
import type { Memory } from './types.js';

export function memoryId(memory: Omit<Memory, 'id'>): string {
  return createHash('sha256').update(JSON.stringify(memory)).digest('hex');
}

export function makeMemory(input: Omit<Memory, 'id'>): Memory { return { id: memoryId(input), ...input }; }

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(x => x && ['text', 'input_text', 'output_text'].includes(x.type) && typeof x.text === 'string').map(x => x.text).join('\n');
}

// Chunk boundaries are deterministic, so append-only session files can be safely reimported.
export async function readSession(path: string, source: 'codex' | 'claude'): Promise<{ memories: Memory[]; warnings: string[] }> {
  const memories: Memory[] = [], warnings: string[] = [];
  let session = basename(path), project = '', line = 0;
  const input = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const raw of input) {
    line++;
    if (!raw.trim()) continue;
    let row;
    try { row = JSON.parse(raw); } catch { warnings.push(`Line ${line}: invalid or incomplete JSON; retry after the writer finishes`); continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { warnings.push(`Line ${line}: invalid record shape`); continue; }
    if (source === 'codex' && row.type === 'session_meta') {
      session = row.payload?.id ?? session; project = row.payload?.cwd ?? project; continue;
    }
    let role: unknown, content: unknown;
    if (source === 'codex') {
      // event_msg duplicates response_item in current Codex logs; import only canonical messages.
      if (row.type !== 'response_item' || row.payload?.type !== 'message') continue;
      role = row.payload.role; content = row.payload.content;
    } else {
      if (!['user', 'assistant'].includes(row.type)) continue;
      session = row.sessionId ?? session; project = row.cwd ?? project;
      role = row.message?.role ?? row.type; content = row.message?.content;
    }
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textContent(content).trim();
    if (!text) continue;
    for (let offset = 0; offset < text.length; offset += 2400) {
      memories.push(makeMemory({ text: text.slice(offset, offset + 2400), source, session, role,
        timestamp: typeof row.timestamp === 'string' ? row.timestamp : '',
        locator: `${basename(path)}:L${line}:C${offset + 1}`, project }));
    }
  }
  return { memories, warnings };
}

export async function discover(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await discover(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path);
  }
  return found.sort();
}

// Discovery reads a bounded header, not the conversation body. Unknown headers
// remain unclassified rather than being matched by incidental mentions of a path.
export async function discoverProject(root: string, source: 'codex' | 'claude', project: string): Promise<string[]> {
  const matches: string[] = [];
  for (const path of await discover(root)) {
    const file = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(65_536);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (!row || typeof row !== 'object') continue;
        const cwd = source === 'codex' && row.type === 'session_meta' ? row.payload?.cwd : source === 'claude' ? row.cwd : undefined;
        if (typeof cwd !== 'string') continue;
        if (cwd.replace(/\/$/, '') === project.replace(/\/$/, '')) matches.push(path);
        break;
      }
    } finally { await file.close(); }
  }
  return matches;
}
