import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Store, validateBundle } from './store.js';
import { makeMemory, readSession } from './sessions.js';
import type { EmbeddingProvider } from './types.js';

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10_000_000) throw new Error('Request exceeds 10 MB');
    chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object');
  return parsed;
}
function equal(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

export function createApp(store: Store, provider: EmbeddingProvider, options: { token?: string; workspace?: boolean } = {}) {
  const token = options.token ?? randomBytes(32).toString('hex');
  if (token.length < 32) throw new Error('Server token must be at least 32 characters');
  const workspace = options.workspace ?? false;
  let busy = false;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const reply = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let ownsLock = false;
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const assets: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
      if (req.method === 'GET' && assets[path] && !workspace) {
        const file = assets[path];
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
        res.end(await readFile(new URL(`../web/${file}`, import.meta.url))); return;
      }
      if (!equal(req.headers.authorization ?? '', `Bearer ${token}`)) { reply(401, { error: 'Authentication required' }); return; }
      // Browser cross-origin requests never receive CORS access, including localhost rebinding.
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) { reply(403, { error: 'Cross-origin request rejected' }); return; }
      }
      if (workspace && path !== '/api/bundle') { reply(404, { error: 'Workspace supports bundle exchange only' }); return; }
      if (req.method === 'GET' && path === '/api/bundle' && workspace) {
        reply(200, { format: 'pensieve/v1', createdAt: new Date().toISOString(), memories: store.list() }); return;
      }
      if (req.method === 'GET' && path === '/api/memories') { reply(200, { ...store.stats(), items: store.list() }); return; }
      if (req.method === 'GET' && path === '/api/status') { reply(200, { ...store.stats(), provider: provider.identity }); return; }
      if (req.method !== 'POST') { reply(404, { error: 'Not found' }); return; }
      if (busy) { reply(409, { error: 'Another operation is running; retry shortly' }); return; }
      busy = true; ownsLock = true;
      const input = await body(req);
      switch (path) {
        case '/api/capture': {
          const text = required(input.text, 'Text');
          if (text.length > 10_000) throw new Error('Memory exceeds 10,000 characters');
          const memory = makeMemory({ text, source: 'manual', session: 'capture', role: 'user', timestamp: new Date().toISOString(), locator: 'manual', project: '' });
          store.add([memory]); reply(201, memory); break;
        }
        case '/api/import-session': {
          if (!['codex', 'claude'].includes(String(input.source))) throw new Error('Source must be codex or claude');
          const parsed = await readSession(required(input.path, 'Path'), input.source as 'codex' | 'claude');
          reply(200, { imported: store.add(parsed.memories), warnings: parsed.warnings }); break;
        }
        case '/api/index': reply(200, { indexed: await store.index(provider) }); break;
        case '/api/search': reply(200, { hits: await store.search(required(input.query, 'Query'), provider) }); break;
        case '/api/export': {
          if (!Array.isArray(input.ids) || input.ids.some(x => typeof x !== 'string')) throw new Error('Explicit memory IDs required');
          reply(200, store.bundle(input.ids)); break;
        }
        case '/api/bundle': reply(200, { imported: store.add(validateBundle(input).memories) }); break;
        default: reply(404, { error: 'Not found' });
      }
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Request failed' }); }
    finally { if (ownsLock) busy = false; }
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  return { server, token };
}
