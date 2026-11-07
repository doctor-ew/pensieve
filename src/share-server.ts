import { createServer, type IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { answerQuestion, emailAddress, ShareStore, type Mailer } from './executive.js';

async function json(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw new Error('Request exceeds 10 MB'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value;
}
const digest = (value: string) => createHash('sha256').update(value).digest();
export function createShareServer(store: ShareStore, options: { ownerToken: string; publicUrl: string; mailer: Mailer; emailReady?: boolean }) {
  if (options.ownerToken.length < 32) throw new Error('Owner token must contain at least 32 characters');
  const publicUrl = new URL(options.publicUrl);
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(publicUrl.hostname))) throw new Error('Public sharing requires HTTPS');
  const rates = new Map<string, { start: number; count: number }>();
  let activeAnswers = 0;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const reply = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url ?? '/', options.publicUrl).pathname;
      if (req.method === 'GET' && path === '/health') { reply(200, { status: 'ok' }); return; }
      if (req.method === 'GET' && path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const asset = path === '/' ? 'welcome.html' : /^\/s\/[a-f0-9]{32}$/.test(path) ? 'reader.html' : path === '/reader.js' ? 'reader.js' : path === '/style.css' ? 'style.css' : undefined;
      if (req.method === 'GET' && asset) {
        res.writeHead(200, { 'Content-Type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' });
        res.end(await readFile(new URL(`../web/${asset}`, import.meta.url))); return;
      }
      if (req.headers.origin && req.headers.origin !== publicUrl.origin) { reply(403, { error: 'Cross-origin request rejected' }); return; }
      // Per connection address, never trust client-supplied forwarding headers. Behind
      // a proxy this is intentionally a conservative aggregate limit.
      const now = Date.now(), address = req.socket.remoteAddress ?? 'unknown';
      for (const [key, rate] of rates) if (now - rate.start > 60_000) rates.delete(key);
      const rate = rates.get(address) ?? { start: now, count: 0 }; rate.count++; rates.set(address, rate);
      if (rate.count > 120 || rates.size > 10_000) { reply(429, { error: 'Too many requests; try again shortly' }); return; }
      const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (path.startsWith('/api/shares')) {
        if (!timingSafeEqual(digest(bearer), digest(options.ownerToken))) { reply(401, { error: 'Owner authentication required' }); return; }
        if (req.method === 'GET' && path === '/api/shares') { reply(200, { shares: store.list().map(s => ({ ...s, url: new URL(`/s/${s.id}`, publicUrl).href })) }); return; }
        if (req.method === 'POST' && path === '/api/shares') {
          const input = await json(req);
          if (input.accessMode !== 'invitation-link' && options.emailReady === false) throw new Error('Email-code sign-in is not configured. Use private invitation links instead.');
          const snapshot = store.create(input);
          const url = new URL(`/s/${snapshot.id}`, publicUrl).href;
          const invitations = snapshot.accessMode === 'invitation-link' ? snapshot.recipients.map(email => {
            const link = `${url}#${store.invitation(snapshot.id, email)}`;
            const message = `You have been invited to read ${snapshot.title}.\n\nOpen your private invitation:\n${link}\n\nThis link expires ${new Date(snapshot.expiresAt).toISOString().slice(0, 10)}. It grants access to the shared brief and memories. Please do not forward it.\n\nDoctor Ew's Laboratory`;
            return { email, url: link, mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(snapshot.title)}&body=${encodeURIComponent(message)}` };
          }) : [];
          reply(201, { id: snapshot.id, url, expiresAt: snapshot.expiresAt, invitations }); return;
        }
        const content = path.match(/^\/api\/shares\/([a-f0-9]{32})\/content$/);
        if (content && req.method === 'GET') { reply(200, store.get(content[1])); return; }
        if (content && req.method === 'POST') {
          const snapshot = store.updateContent(content[1], await json(req));
          reply(200, { id: snapshot.id, title: snapshot.title, count: snapshot.bundle.memories.length, expiresAt: snapshot.expiresAt }); return;
        }
        const revoke = path.match(/^\/api\/shares\/([a-f0-9]{32})\/revoke$/);
        if (req.method === 'POST' && revoke) { store.revoke(revoke[1]); reply(200, { revoked: true }); return; }
      }
      const route = path.match(/^\/api\/reader\/([a-f0-9]{32})(?:\/(code|verify|ask))?$/);
      if (!route) { reply(404, { error: 'Not found' }); return; }
      const [, id, action] = route;
      if (req.method === 'POST' && action === 'code') {
        if (options.emailReady === false) throw new Error('Open the complete private invitation link from your email. This service does not use email sign-in codes.');
        const body = await json(req); await store.challenge(id, emailAddress(body.email), options.mailer);
        reply(200, { message: 'If this email is invited, a sign-in code is on its way. Check your inbox.' }); return;
      }
      if (req.method === 'POST' && action === 'verify') {
        const body = await json(req);
        if (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) throw new Error('Enter the eight-digit code from your email');
        reply(200, { token: store.verify(id, emailAddress(body.email), body.code) }); return;
      }
      let snapshot;
      try { snapshot = store.authorize(id, bearer); } catch { reply(401, { error: 'Sign in again, or ask the sender whether this share is still available.' }); return; }
      if (req.method === 'GET' && !action) {
        // Recipient addresses and owner credentials never enter the reader payload.
        reply(200, { title: snapshot.title, brief: snapshot.brief, createdAt: snapshot.createdAt, expiresAt: snapshot.expiresAt, memories: snapshot.bundle.memories, cloudAllowed: snapshot.cloudAllowed }); return;
      }
      if (req.method === 'POST' && action === 'ask') {
        if (activeAnswers >= 4) { reply(429, { error: 'The answer service is busy; retry shortly' }); return; }
        const body = await json(req);
        if (typeof body.question !== 'string') throw new Error('A question is required');
        activeAnswers++;
        try {
          const answer = await answerQuestion(snapshot, body.question);
          store.authorize(id, bearer); // Recheck expiry/revocation after an external model call.
          reply(200, answer);
        } finally { activeAnswers--; }
        return;
      }
      reply(404, { error: 'Not found' });
    } catch (error) { reply(400, { error: error instanceof Error ? error.message : 'Request failed' }); }
  });
  server.requestTimeout = 90_000; server.headersTimeout = 10_000;
  return server;
}
