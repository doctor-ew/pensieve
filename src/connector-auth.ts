import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError, InvalidRequestError, UnsupportedGrantTypeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { TeamStore } from './team-store.js';

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
interface Pending { clientId: string; redirectUri: string; challenge: string; state?: string; resource: string }
interface Grant extends Pending { actor: string }
interface Row { body: string; expires: number }

/** Durable OAuth state contains hashes of bearer secrets, never raw credentials. */
export class ConnectorAuth implements OAuthServerProvider {
  private readonly db: DatabaseSync;
  readonly resource: URL;
  readonly clientsStore: OAuthRegisteredClientsStore;
  constructor(private readonly store: TeamStore, readonly publicUrl: URL, path: string, private readonly now = () => Date.now()) {
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
        (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['127.0.0.1','localhost'].includes(publicUrl.hostname)))) throw new Error('Connector URL must be HTTPS or loopback HTTP origin');
    this.resource = new URL('/mcp',publicUrl);
    if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path,0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS connector_clients(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_pending(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_codes(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connector_tokens(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);`);
    this.clientsStore = {
      getClient: id => { const row = this.db.prepare('SELECT body FROM connector_clients WHERE id=?').get(id); return row ? JSON.parse(row.body as string) as OAuthClientInformationFull : undefined; },
      registerClient: client => {
        if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM connector_clients').get()!.n) >= 1000) throw new InvalidClientMetadataError('Registration capacity reached');
        if (client.token_endpoint_auth_method !== 'none' || (client.grant_types ?? ['authorization_code']).some(x => x !== 'authorization_code') ||
            (client.response_types ?? ['code']).some(x => x !== 'code') || !client.redirect_uris.length || client.redirect_uris.length > 10 || (client.client_name?.length ?? 0) > 160) throw new InvalidClientMetadataError('Use public authorization-code clients');
        for (const uri of client.redirect_uris) {
          const u = new URL(uri);
          if (uri.length > 2048 || u.username || u.password || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))) throw new InvalidClientMetadataError('Invalid redirect URI');
        }
        const result: OAuthClientInformationFull = {client_id:random(),client_id_issued_at:Math.floor(this.now()/1000),redirect_uris:client.redirect_uris,client_name:client.client_name,token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:'memories'};
        this.db.prepare('INSERT INTO connector_clients VALUES (?,?)').run(result.client_id,JSON.stringify(result)); return result;
      }
    };
  }
  close() { this.db.close(); }
  private prune() { for (const table of ['connector_pending','connector_codes','connector_tokens']) this.db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(this.now()); }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri) || params.resource?.href !== this.resource.href ||
      (params.scopes ?? []).some(x => x !== 'memories') || !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state?.length ?? 0)>2048) throw new InvalidRequestError('Invalid authorization binding');
    this.prune();
    if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM connector_pending').get()!.n)>=2000) throw new InvalidRequestError('Too many pending authorizations');
    const nonce=random(); const pending:Pending={clientId:client.client_id,redirectUri:params.redirectUri,challenge:params.codeChallenge,state:params.state,resource:this.resource.href};
    this.db.prepare('INSERT INTO connector_pending VALUES (?,?,?)').run(digest(nonce),JSON.stringify(pending),this.now()+300_000);
    res.cookie('pensieve_consent',nonce,{httpOnly:true,sameSite:'lax',secure:this.publicUrl.protocol==='https:',path:'/connector/consent',maxAge:300_000});
    res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
    res.type('html').send(`<!doctype html><html><head><title>Connect Pensieve</title></head><body><h1>Connect ${escapeHtml(client.client_name ?? 'this client')} to Pensieve</h1><p>Allow this client to use memories in pools you can access. This does not grant access to other pools.</p><form method="post" action="/connector/consent"><input type="hidden" name="nonce" value="${nonce}"><label>Your personal Pensieve credential <input type="password" name="credential" autocomplete="off" maxlength="512"></label><button name="decision" value="approve">Allow connection</button><button name="decision" value="deny">Cancel</button></form></body></html>`);
  }
  consent(nonce: string, cookieNonce: string, credential: string, decision: string): string {
    if (!nonce || nonce.length>128 || nonce!==cookieNonce) throw new InvalidRequestError('Invalid consent request');
    const row=this.db.prepare('SELECT body,expires FROM connector_pending WHERE digest=?').get(digest(nonce)) as unknown as Row|undefined;
    if (!row || row.expires<=this.now()) throw new InvalidRequestError('Expired consent request');
    if (!['approve','deny'].includes(decision)) throw new InvalidRequestError('Invalid consent decision');
    const pending=JSON.parse(row.body) as Pending; const target=new URL(pending.redirectUri);
    // A bad credential cannot consume a valid pending request; no credential is persisted.
    const actor=decision==='approve'?this.store.authenticate(credential).id:undefined;
    this.db.prepare('DELETE FROM connector_pending WHERE digest=?').run(digest(nonce));
    if (actor) { const code=random(); this.db.prepare('INSERT INTO connector_codes VALUES (?,?,?)').run(digest(code),JSON.stringify({...pending,actor}),this.now()+300_000); target.searchParams.set('code',code); }
    else target.searchParams.set('error','access_denied');
    if (pending.state!==undefined) target.searchParams.set('state',pending.state); return target.href;
  }
  private code(client: OAuthClientInformationFull, code: string): Grant {
    if (!code || code.length>256) throw new InvalidGrantError('Invalid code');
    const row=this.db.prepare('SELECT body,expires FROM connector_codes WHERE digest=?').get(digest(code)) as unknown as Row|undefined;
    if (!row || row.expires<=this.now()) throw new InvalidGrantError('Invalid or expired code');
    const grant=JSON.parse(row.body) as Grant;
    if (grant.clientId!==client.client_id) throw new InvalidGrantError('Invalid client binding');
    try { this.store.getUser(grant.actor); } catch { throw new InvalidGrantError('Revoked identity'); }
    return grant;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) { return this.code(client,code).challenge; }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirect?: string, resource?: URL): Promise<OAuthTokens> {
    const grant=this.code(client,code);
    if (redirect!==grant.redirectUri || resource?.href!==grant.resource) throw new InvalidGrantError('Invalid resource or redirect binding');
    // SDK validates S256 PKCE immediately before invoking this synchronous exchange.
    const token=random(); this.db.exec('BEGIN IMMEDIATE');
    try {
      const removed=this.db.prepare('DELETE FROM connector_codes WHERE digest=?').run(digest(code));
      if (removed.changes!==1) throw new InvalidGrantError('Code already consumed');
      this.db.prepare('INSERT INTO connector_tokens VALUES (?,?,?)').run(digest(token),JSON.stringify({actor:grant.actor,clientId:grant.clientId,resource:grant.resource}),this.now()+3600_000);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
    return {access_token:token,token_type:'Bearer',expires_in:3600,scope:'memories'};
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> { throw new UnsupportedGrantTypeError('Reauthorize after expiry; refresh is unsupported'); }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token || token.length>512) throw new InvalidTokenError('Invalid access token');
    const row=this.db.prepare('SELECT body,expires FROM connector_tokens WHERE digest=?').get(digest(token)) as unknown as Row|undefined;
    if (!row || row.expires<=this.now()) throw new InvalidTokenError('Invalid or expired access token');
    const grant=JSON.parse(row.body) as {actor:string;clientId:string;resource:string};
    if (grant.resource!==this.resource.href) throw new InvalidTokenError('Wrong resource');
    try { this.store.getUser(grant.actor); } catch { throw new InvalidTokenError('Revoked identity'); }
    return {token,clientId:grant.clientId,scopes:['memories'],expiresAt:Math.floor(row.expires/1000),resource:this.resource,extra:{actorId:grant.actor}};
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row=this.db.prepare('SELECT body FROM connector_tokens WHERE digest=?').get(digest(request.token));
    if (row && JSON.parse(row.body as string).clientId===client.client_id) this.db.prepare('DELETE FROM connector_tokens WHERE digest=?').run(digest(request.token));
  }
}
