import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { TeamAccessError } from './team-store.js';
import { ShareStore, validateShare } from './executive.js';
import { createShareServer } from './share-server.js';
import {DeliveryLedger,type SecureMailer} from './delivery.js';
import {publicAccessPath,type AccessIdentity,type AccessVerifier} from './access.js';
import type {VerificationGuard} from './verification-guard.js';
import type {TeamRepository,ShareRepository,DeliveryRepository} from './repositories.js';
import type {CognitoAuth} from './cognito.js';
import type {HostedSessions} from './hosted-sessions.js';
import {createIdentityRoutes} from './identity-routes.js';
import { resolvePolicy } from './policy.js';
import type { EmbeddingProvider, Memory, Bundle } from './types.js';

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 10_000_000) throw new HttpError(413, 'Request exceeds 10 MB'); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString());
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value;
}
export interface TeamServerOptions {
  ownerToken: string; publicUrl: string; readerUrl?:string; openSignup?:boolean; access?:AccessVerifier; mailer?:SecureMailer; verification?:VerificationGuard; provider?: EmbeddingProvider; shareStore?: ShareRepository; delivery?:DeliveryRepository; sessionStore?:HostedSessions; cognito?:CognitoAuth;
  handleExtra?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}
export function createTeamServer(store: TeamRepository, options: TeamServerOptions) {
  if(options.openSignup&&!options.access)throw Error('Open signup requires Cloudflare Access verification');
  const publicUrl = new URL(options.publicUrl);
  const readerUrl=new URL(options.readerUrl??options.publicUrl);
  if(readerUrl.protocol!=='https:'&&!(readerUrl.protocol==='http:'&&['localhost','127.0.0.1'].includes(readerUrl.hostname)))throw Error('HTTPS reader URL required');
  if (options.ownerToken.length < 32) throw new Error('Operator token must contain at least 32 characters');
  if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(publicUrl.hostname))) throw new Error('HTTPS required');
  const identityRoutes = createIdentityRoutes(store, {...options, emailReady: !!options.mailer}, {body, HttpError});
  const rates = new Map<string, { time: number; count: number }>();
  const delivery:DeliveryRepository|undefined=options.delivery??(options.shareStore instanceof ShareStore?new DeliveryLedger(options.shareStore.db):undefined);
  const reader = options.shareStore ? createShareServer(options.shareStore, { ownerToken: options.ownerToken, publicUrl: readerUrl.href, emailReady: !!options.mailer, verification:options.verification, mailer: { async sendCode(email,code) { if(!options.mailer||!delivery)throw Error('Email delivery not configured'); (await delivery.reserveCode(email)); await options.mailer.sendCode(email,code); } } }) : undefined;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const reply = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      // Railway probes use their own Host; exempt only the read-only liveness route.
      const railwayHealth = req.method === 'GET' && req.url === '/health' && req.headers.host === 'healthcheck.railway.app' && !req.headers.origin;
      const requestPath=new URL(req.url??'/',publicUrl).pathname;
      const readerHost=req.headers.host===readerUrl.host && publicAccessPath(req,requestPath);
      if ((!railwayHealth && req.headers.host !== publicUrl.host && !readerHost) || (req.headers.origin && req.headers.origin !== (readerHost?readerUrl.origin:publicUrl.origin))) throw new HttpError(403, 'Foreign Host or Origin rejected');
      const now = Date.now();
      for (const [key, rate] of rates) if (now - rate.time > 60_000) rates.delete(key);
      const address = req.socket.remoteAddress ?? 'unknown'; const rate = rates.get(address) ?? { time: now, count: 0 }; rate.count++; rates.set(address, rate);
      if (rate.count > 300 || rates.size > 10_000) throw new HttpError(429, 'Too many requests');
      const url = new URL(req.url ?? '/', publicUrl); const path = url.pathname;
      let accessIdentity:AccessIdentity|void=undefined;
      if(options.access && !publicAccessPath(req,path)){
        const assertion=req.headers['cf-access-jwt-assertion'];
        if(typeof assertion!=='string'||assertion.length>16000)throw new HttpError(401,'Cloudflare Access sign-in required');
        try{accessIdentity=await options.access(assertion);}catch{throw new HttpError(401,'Cloudflare Access sign-in required');}
      }
      if (await identityRoutes.oauth(req, res, url)) return;
      if (options.handleExtra && await options.handleExtra(req, res)) return;
      if (reader && (/^\/s\/[a-f0-9]{32}$/.test(path) || /^\/api\/reader\/[a-f0-9]{32}(?:\/[a-z-]+)?$/.test(path) || ['/reader.js', '/style.css', '/reader-security.js'].includes(path))) { reader.emit('request', req, res); return; }
      if (req.method === 'GET' && path === '/health') { reply(200, { status: 'ok' }); return; }
      const asset = path === '/' ? 'team.html' : path === '/team.js' ? 'team.js' : path === '/style.css' ? 'style.css' : undefined;
      if (req.method === 'GET' && asset) { res.writeHead(200, { 'Content-Type': asset.endsWith('.js') ? 'text/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(await readFile(new URL(`../web/${asset}`, import.meta.url))); return; }
      if (!path.startsWith('/api/team/')) { reply(404, { error: 'Not found' }); return; }
      const user = await identityRoutes.team(req, res, url, accessIdentity);
      if (!user) return;
      if (path === '/api/team/pools') {
        if (req.method === 'GET') { reply(200, { pools: (await store.listPools(user.id)) }); return; }
        if (req.method === 'POST') { const input = await body(req); reply(201, { pool: (await store.createPool(user.id, input.name as string, input.visibility as 'private' | 'shared')) }); return; }
      }
      const match = /^\/api\/team\/pools\/([^/]+)(?:\/(memories|members|index|search|export|shares|policy))?(?:\/([^/]+)\/(revoke|send))?$/.exec(path);
      if (!match) { reply(404, { error: 'Not found' }); return; }
      const [, poolId, action, shareId] = match; const pool = (await store.getPool(user.id, poolId));
      const writer = () => { if (pool.role === 'reader') throw new HttpError(403, 'Writer membership required'); };
      if (req.method === 'GET') {
        if (!action) { reply(200, { pool }); return; }
        if (action === 'memories') { reply(200, store.listMemoryPage ? await store.listMemoryPage(user.id,poolId,{limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined,cursor:url.searchParams.get('cursor')??undefined}) : {memories:await store.listMemories(user.id,poolId)}); return; }
        if (action === 'members') { reply(200, { members: (await store.listMembers(user.id, poolId)) }); return; }
        if (action === 'policy') { const policies = (await store.getPolicies(user.id, poolId, url.searchParams.get('repository') ?? undefined, url.searchParams.get('conversation') ?? undefined)); reply(200, { policies, effective: resolvePolicy(policies) }); return; }
        if (action === 'shares' && options.shareStore) {
          const page=store.listSharePage?await store.listSharePage(user.id,poolId,{limit:Number(url.searchParams.get('limit')??50),cursor:url.searchParams.get('cursor')??undefined}):undefined;
          const allowed=page?undefined:new Set((await store.listShares(user.id,poolId)).map(s=>s.shareId));
          const visible=page?.shares??(await options.shareStore.list()).filter(s=>allowed!.has(s.id));
          const statuses=await delivery?.statuses(visible.map(s=>s.id));
          reply(200,{shares:visible.map(s=>({...s,deliveries:statuses?.get(s.id)??[]})),nextCursor:page?.nextCursor});return;
        }
      }
      if (req.method !== 'POST') { reply(405, { error: 'Method not allowed' }); return; }
      const input = await body(req);
      if (action === 'memories') {
        writer(); const policies = (await store.getPolicies(user.id, poolId, input.repository as string | undefined, input.conversation as string | undefined));
        // With no saved settings, the selected pool is an explicit capture action.
        if (Object.keys(policies).length) {
          const policy = resolvePolicy(policies);
          if (policy.destination === 'off') throw new HttpError(409, 'Capture is disabled by current policy');
          if (policy.destination === 'shared' && policy.pool !== poolId) throw new HttpError(409, 'Policy targets a different pool');
          if (policy.destination === 'private' && pool.visibility !== 'private') throw new HttpError(409, 'Select or create a private pool before saving');
        }
        reply(201, (await store.putMemories(user.id, poolId, input.memories as Memory[], input.provenance as Bundle['provenance']))); return;
      }
      if (action === 'members') { (await store.grantMember(user.id, poolId, input.userId as string, input.role as 'reader' | 'writer')); reply(200, { members: (await store.listMembers(user.id, poolId)) }); return; }
      if (action === 'policy') { writer(); (await store.setPolicy(user.id, poolId, input.scope as 'team' | 'repository' | 'conversation', input.key as string, input.policy)); const policies = (await store.getPolicies(user.id, poolId, input.repository as string | undefined, input.conversation as string | undefined)); reply(200, { policies, effective: resolvePolicy(policies) }); return; }
      if (action === 'index' || action === 'search') {
        if (action === 'index') writer();
        if (!options.provider) throw new HttpError(503, 'Embedding provider is not configured on this server');
        if (action === 'index') reply(200, { indexed: await store.index(user.id, poolId, options.provider) });
        else reply(200, { hits: await store.search(user.id, poolId, input.query as string, options.provider, input.limit as number | undefined) }); return;
      }
      if (action === 'export') { reply(200, (await store.exportBundle(user.id, poolId, input.ids as string[]))); return; }
      if (action === 'shares' && options.shareStore) {
        if(shareId && match[4]==='send'){
          writer(); (await store.authorizeShareRevocation(user.id,poolId,shareId));
          if(!options.mailer||!delivery)throw new HttpError(503,'Email delivery is not configured');
          const snapshot=(await options.shareStore.get(shareId));
          const prior=(await delivery.status(shareId));if(prior.length){reply(200,{deliveries:prior});return;}
          const messages=snapshot.recipients.map(email=>({email,title:snapshot.title,url:new URL('/s/'+snapshot.id,readerUrl).href,expiresAt:snapshot.expiresAt,verified:snapshot.accessMode==='email-code'}));
          const results=await delivery.send(user.id,shareId,messages,delivery.runBatch ? options.mailer : {
            sendCode:options.mailer.sendCode,
            sendInvitation:async message=>{
              (await store.authorizeShareRevocation(user.id,poolId,shareId));(await options.shareStore!.get(shareId));
              const url=message.url+(snapshot.accessMode==='invitation-link'?'#'+(await options.shareStore!.invitation(snapshot.id,message.email)):'');
              await options.mailer!.sendInvitation({...message,url});
            }
          });
          reply(200,{deliveries:results});return;
        }
        if (shareId) { (await store.authorizeShareRevocation(user.id, poolId, shareId)); (await options.shareStore.revoke(shareId)); reply(200, { ok: true }); return; }
        writer(); const bundle = (await store.exportBundle(user.id, poolId, input.ids as string[]));
        const accessMode=input.accessMode??'invitation-link';
        if(accessMode==='email-code'&&!options.mailer)throw new HttpError(503,'Verified sharing requires configured email delivery');
        const shareInput={...validateShare({ ...input, bundle, accessMode, cloudAllowed: input.cloudAllowed ?? false }),ids:input.ids as string[]};
        const snapshot = store.createShare ? await store.createShare(user.id,poolId,shareInput) : await options.shareStore.create(shareInput);
        if(!store.createShare){try { await store.recordShare(user.id,poolId,snapshot.id,input.ids as string[]); } catch(error){await options.shareStore.revoke(snapshot.id);throw error;}}
        const invitations = await Promise.all(snapshot.recipients.map(async email => { const url = new URL(`/s/${snapshot.id}`, readerUrl).href + (snapshot.accessMode==='invitation-link'?'#' + (await options.shareStore!.invitation(snapshot.id, email)):''); return { email, url, mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(snapshot.title)}&body=${encodeURIComponent(`Open your private Pensieve invitation: ${url}\nExpires ${new Date(snapshot.expiresAt).toISOString()}. ${snapshot.accessMode==='invitation-link'?'Anyone with this link can open it.':'Verify your invited email to open it.'}`)}` }; }));
        reply(201, { id: snapshot.id, expiresAt: snapshot.expiresAt, invitations }); return;
      }
      reply(404, { error: 'Not found' });
    } catch (error) { const status = error instanceof HttpError || error instanceof TeamAccessError ? error.status : 400; reply(status, { error: error instanceof Error ? error.message : 'Request failed' }); }
  });
}
