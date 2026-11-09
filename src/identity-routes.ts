import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TeamUser } from './team-store.js';
import type { TeamRepository } from './repositories.js';
import type { AccessIdentity } from './access.js';
import type { CognitoAuth } from './cognito.js';
import type { HostedSessions } from './hosted-sessions.js';

const hash = (text: string) => createHash('sha256').update(text).digest();
interface IdentityOptions {
  ownerToken: string;
  publicUrl: string;
  openSignup?: boolean;
  sessionStore?: HostedSessions;
  cognito?: CognitoAuth;
  emailReady: boolean;
}
interface HttpHelpers {
  body(req: IncomingMessage): Promise<Record<string, unknown>>;
  HttpError: new (status: number, message: string) => Error;
}
/** Identity transport and session issuance for local, Access, and Cognito modes. */
export function createIdentityRoutes(store: TeamRepository, options: IdentityOptions, { body, HttpError }: HttpHelpers) {
  if (options.cognito && !options.sessionStore) throw Error('Cognito requires durable sessions');
  const publicUrl = new URL(options.publicUrl);
  const sessions = new Map<string, { userId: string; expires: number; accessKey?: string }>();
  const cookie = (value: string, age: number) => `pensieve_session=${value}; Path=/; HttpOnly; SameSite=${options.cognito?'Lax':'Strict'}; Max-Age=${age}${publicUrl.protocol === 'https:' ? '; Secure' : ''}`;
  return {
    async oauth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
      const path = url.pathname;
      if(options.cognito && req.method==='GET' && (path==='/auth/login'||path==='/auth/signup')){
        const binding=randomBytes(32).toString('hex');
        const location=new URL(await options.cognito.begin(binding,url.searchParams.get('returnTo')??'/'));
        if(path==='/auth/signup')location.pathname='/signup';
        res.setHeader('Set-Cookie',`pensieve_login=${binding}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=300${publicUrl.protocol==='https:'?'; Secure':''}`);
        res.writeHead(302,{Location:location.href});res.end();return true;
      }
      if(options.cognito && req.method==='GET' && path==='/auth/callback'){
        const binding=/(?:^|;\s*)pensieve_login=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie??'')?.[1]??'';
        const {identity,returnTo}=await options.cognito.complete({code:url.searchParams.get('code')??'',state:url.searchParams.get('state')??'',browserBinding:binding});
        const user=await store.accessUser(identity.issuer,identity.subject,identity.email);
        const token=await options.sessionStore!.create(user.id,identity);
        res.setHeader('Set-Cookie',[cookie(token,43_200),`pensieve_login=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0${publicUrl.protocol==='https:'?'; Secure':''}`]);
        res.writeHead(303,{Location:returnTo});res.end();return true;
      }
      return false;
    },
    async team(req: IncomingMessage, res: ServerResponse, url: URL, accessIdentity: AccessIdentity | void): Promise<TeamUser | undefined> {
      const now = Date.now();
      for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
      const path = url.pathname;
      const reply = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const sessionToken = /(?:^|;\s*)pensieve_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
      const revokeUser = /^\/api\/team\/admin\/users\/([^/]+)\/revoke$/.exec(path);
      if (revokeUser && req.method === 'POST') {
        if (!bearer || !timingSafeEqual(hash(bearer), hash(options.ownerToken))) throw new HttpError(401, 'Operator authentication required');
        (await store.revokeUser(revokeUser[1])); reply(200, { ok: true }); return;
      }
      if (path === '/api/team/admin/users' && req.method === 'POST') {
        if (!bearer || !timingSafeEqual(hash(bearer), hash(options.ownerToken))) throw new HttpError(401, 'Operator authentication required');
        const input = await body(req); reply(201, (await store.createUser(input.name as string))); return;
      }
      if(path==='/api/team/signin-options'&&req.method==='GET'){reply(200,{openSignup:!!options.openSignup,loginUrl:options.cognito?'/auth/login':undefined,signupUrl:options.cognito?'/auth/signup':undefined});return;}
      if (path === '/api/team/access-session' && req.method === 'POST') {
        if(req.headers.origin!==publicUrl.origin)throw new HttpError(403,'Same-origin sign-in required');
        if(!options.openSignup||!accessIdentity?.subject||!accessIdentity.email)throw new HttpError(401,'Verified human identity required');
        if(sessions.size>=10_000)throw new HttpError(429,'Session capacity reached');
        const user=(await store.accessUser(accessIdentity.issuer,accessIdentity.subject,accessIdentity.email));
        const accessKey=JSON.stringify([accessIdentity.issuer,accessIdentity.subject]);
        const prior=[...sessions].filter(([,session])=>session.userId===user.id);
        for(const [key] of prior.slice(0,Math.max(0,prior.length-4)))sessions.delete(key);
        const token=randomBytes(32).toString('hex'); sessions.set(hash(token).toString('hex'),{userId:user.id,expires:now+43_200_000,accessKey});
        res.setHeader('Set-Cookie',cookie(token,43_200));reply(200,{user});return;
      }
      if (path === '/api/team/session' && req.method === 'POST') {
        if (req.headers.origin !== publicUrl.origin) throw new HttpError(403, 'Same-origin sign-in required');
        const input = await body(req); const user = (await store.authenticate(input.token as string));
        if (sessions.size >= 10_000) throw new HttpError(429, 'Session capacity reached');
        const token = options.sessionStore ? await options.sessionStore.create(user.id) : randomBytes(32).toString('hex');
        if(!options.sessionStore)sessions.set(hash(token).toString('hex'), { userId: user.id, expires: now + 43_200_000 });
        res.setHeader('Set-Cookie', cookie(token, 43_200)); reply(200, { user }); return;
      }
      let user: TeamUser;
      if (bearer) user = (await store.authenticate(bearer));
      else {
        const session = sessionToken ? (options.sessionStore ? await options.sessionStore.get(sessionToken) : sessions.get(hash(sessionToken).toString('hex'))) : undefined;
        if (!session) throw new HttpError(401, 'Sign in with your personal invitation');
        if('accessKey' in session && session.accessKey&&(!accessIdentity?.subject||session.accessKey!==JSON.stringify([accessIdentity.issuer,accessIdentity.subject])))throw new HttpError(401,'Sign in with your current verified identity');
        user = (await store.getUser(session.userId));
        if (req.method !== 'GET' && req.headers.origin !== publicUrl.origin) throw new HttpError(403, 'Same-origin mutation required');
      }
      if(path==='/api/team/personal-token'&&req.method==='POST'){
        if(!store.rotatePersonalToken)throw new HttpError(404,'Personal token creation unavailable in this mode');
        reply(200,await store.rotatePersonalToken(user.id));return;
      }
      if(path==='/api/team/link-identity'&&req.method==='POST'){
        if(!options.sessionStore||!sessionToken||req.headers.origin!==publicUrl.origin)throw new HttpError(403,'Authenticated browser required');
        const current=await options.sessionStore.get(sessionToken);
        if(!current?.identity)throw new HttpError(403,'Sign in with your verified email first');
        const input=await body(req);const linked=await options.sessionStore.linkIdentity(current.identity,input.token as string);
        await options.sessionStore.destroy(sessionToken);
        const token=await options.sessionStore.create(linked.id,current.identity);
        res.setHeader('Set-Cookie',cookie(token,43_200));reply(200,{user:linked});return;
      }
      if (path === '/api/team/me' && req.method === 'GET') { reply(200, { user, capabilities:{email:options.emailReady,linkIdentity:!!options.cognito,personalToken:!!store.rotatePersonalToken} }); return; }
      if (path === '/api/team/logout' && req.method === 'POST') { if (sessionToken) {if(options.sessionStore)await options.sessionStore.destroy(sessionToken);else sessions.delete(hash(sessionToken).toString('hex'));} res.setHeader('Set-Cookie', cookie('', 0)); reply(200, { ok: true, ...(options.cognito?{logoutUrl:options.cognito.logoutUrl()}:{}) }); return; }
      return user;
    },
  };
}
