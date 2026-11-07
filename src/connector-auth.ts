import { createHash, randomBytes } from 'node:crypto';
import {SqliteConnectorStorage,type ConnectorStorage,type ConnectorRow} from './connector-storage.js';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError, InvalidRequestError, UnsupportedGrantTypeError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { TeamRepository } from './repositories.js';

const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const random = () => randomBytes(32).toString('base64url');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
interface Pending { clientId: string; redirectUri: string; challenge: string; state?: string; resource: string }
interface Grant extends Pending { actor: string }

/** Durable OAuth state contains hashes of bearer secrets, never raw credentials. */
export class ConnectorAuth implements OAuthServerProvider {
  private readonly persistence:ConnectorStorage;
  // SDK forwards the verifier only when the provider takes responsibility for PKCE.
  readonly skipLocalPkceValidation=true;
  readonly resource: URL;
  readonly clientsStore: OAuthRegisteredClientsStore;
  constructor(private readonly store: TeamRepository, readonly publicUrl: URL, path: string, private readonly now = () => Date.now(), storage?:ConnectorStorage) {
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/' ||
        (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['127.0.0.1','localhost'].includes(publicUrl.hostname)))) throw new Error('Connector URL must be HTTPS or loopback HTTP origin');
    this.resource = new URL('/mcp',publicUrl);
    this.persistence=storage??new SqliteConnectorStorage(path);
    this.clientsStore = {
      getClient: async id => { const row=await this.persistence.get('connector_clients',id); return row?JSON.parse(row.body) as OAuthClientInformationFull:undefined; },
      registerClient: async client => {
        if (client.token_endpoint_auth_method !== 'none' || (client.grant_types ?? ['authorization_code']).some(x => x !== 'authorization_code') ||
            (client.response_types ?? ['code']).some(x => x !== 'code') || !client.redirect_uris.length || client.redirect_uris.length > 10 || (client.client_name?.length ?? 0) > 160) throw new InvalidClientMetadataError('Use public authorization-code clients');
        for (const uri of client.redirect_uris) {
          const u = new URL(uri);
          if (uri.length > 2048 || u.username || u.password || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(u.hostname)))) throw new InvalidClientMetadataError('Invalid redirect URI');
        }
        const result: OAuthClientInformationFull = {client_id:random(),client_id_issued_at:Math.floor(this.now()/1000),redirect_uris:client.redirect_uris,client_name:client.client_name,token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:'memories'};
        await this.persistence.registerClient({table:'connector_clients',key:result.client_id,row:{body:JSON.stringify(result)}},this.now()); return result;
      }
    };
  }
  close() { this.persistence.close(); }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri) || params.resource?.href !== this.resource.href ||
      (params.scopes ?? []).some(x => x !== 'memories') || !/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || (params.state?.length ?? 0)>2048) throw new InvalidRequestError('Invalid authorization binding');
    await this.persistence.prune(this.now());
    const nonce=random(); const pending:Pending={clientId:client.client_id,redirectUri:params.redirectUri,challenge:params.codeChallenge,state:params.state,resource:this.resource.href};
    await this.persistence.insert({table:'connector_pending',key:digest(nonce),row:{body:JSON.stringify(pending),expires:this.now()+300_000}},2000);
    res.cookie('pensieve_consent',nonce,{httpOnly:true,sameSite:'lax',secure:this.publicUrl.protocol==='https:',path:'/connector/consent',maxAge:300_000});
    res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Cache-Control','no-store');
    res.type('html').send(`<!doctype html><html><head><title>Connect Pensieve</title></head><body><h1>Connect ${escapeHtml(client.client_name ?? 'this client')} to Pensieve</h1><p>Allow this client to use memories in pools you can access. This does not grant access to other pools.</p><form method="post" action="/connector/consent"><input type="hidden" name="nonce" value="${nonce}"><label>Personal Pensieve credential (leave blank if signed in) <input type="password" name="credential" autocomplete="off" maxlength="512"></label><button name="decision" value="approve">Allow connection</button><button name="decision" value="deny">Cancel</button></form></body></html>`);
  }
  async consent(nonce: string, cookieNonce: string, credential: string, decision: string, authenticatedActorId?:string): Promise<string> {
    if (!nonce || nonce.length>128 || nonce!==cookieNonce) throw new InvalidRequestError('Invalid consent request');
    const row=await this.persistence.get('connector_pending',digest(nonce));
    if (!row || (row.expires??0)<=this.now()) throw new InvalidRequestError('Expired consent request');
    if (!['approve','deny'].includes(decision)) throw new InvalidRequestError('Invalid consent decision');
    const pending=JSON.parse(row.body) as Pending; const target=new URL(pending.redirectUri);
    // A bad credential cannot consume a valid pending request; no credential is persisted.
    const actor=decision==='approve'?(credential?(await this.store.authenticate(credential)).id:authenticatedActorId?(await this.store.getUser(authenticatedActorId)).id:undefined):undefined;
    if(decision==='approve'&&!actor)throw new InvalidRequestError('Sign in or provide your personal credential');
    const code=actor?random():undefined;
    const consumed=await this.persistence.consume({table:'connector_pending',key:digest(nonce),row},this.now(),code?{table:'connector_codes',key:digest(code),row:{body:JSON.stringify({...pending,actor}),expires:this.now()+300_000}}:undefined);
    if(!consumed)throw new InvalidRequestError('Consent already consumed');
    if(code)target.searchParams.set('code',code);else target.searchParams.set('error','access_denied');
    if (pending.state!==undefined) target.searchParams.set('state',pending.state); return target.href;
  }
  private async code(client: OAuthClientInformationFull, code: string): Promise<{grant:Grant;row:ConnectorRow}> {
    if (!code || code.length>256) throw new InvalidGrantError('Invalid code');
    const row=await this.persistence.get('connector_codes',digest(code));
    if (!row || (row.expires??0)<=this.now()) throw new InvalidGrantError('Invalid or expired code');
    const grant=JSON.parse(row.body) as Grant;
    if (grant.clientId!==client.client_id) throw new InvalidGrantError('Invalid client binding');
    try { await this.store.getUser(grant.actor); } catch { throw new InvalidGrantError('Revoked identity'); }
    return {grant,row};
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string) { return (await this.code(client,code)).grant.challenge; }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, verifier?: string, redirect?: string, resource?: URL): Promise<OAuthTokens> {
    const {grant,row}=await this.code(client,code);
    if (redirect!==grant.redirectUri || resource?.href!==grant.resource) throw new InvalidGrantError('Invalid resource or redirect binding');
    // Validate here as well as in SDK routing so direct callers cannot bypass PKCE.
    if(!verifier||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||digest(verifier)!==grant.challenge)throw new InvalidGrantError('Invalid PKCE verifier');
    const token=random();
    const consumed=await this.persistence.consume({table:'connector_codes',key:digest(code),row},this.now(),{table:'connector_tokens',key:digest(token),row:{body:JSON.stringify({actor:grant.actor,clientId:grant.clientId,resource:grant.resource}),expires:this.now()+3600_000}});
    if(!consumed)throw new InvalidGrantError('Code already consumed');
    return {access_token:token,token_type:'Bearer',expires_in:3600,scope:'memories'};
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> { throw new UnsupportedGrantTypeError('Reauthorize after expiry; refresh is unsupported'); }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token || token.length>512) throw new InvalidTokenError('Invalid access token');
    const row=await this.persistence.get('connector_tokens',digest(token));
    if (!row || (row.expires??0)<=this.now()) throw new InvalidTokenError('Invalid or expired access token');
    const grant=JSON.parse(row.body) as {actor:string;clientId:string;resource:string};
    if (grant.resource!==this.resource.href) throw new InvalidTokenError('Wrong resource');
    try { await this.store.getUser(grant.actor); } catch { throw new InvalidTokenError('Revoked identity'); }
    return {token,clientId:grant.clientId,scopes:['memories'],expiresAt:Math.floor(row.expires!/1000),resource:this.resource,extra:{actorId:grant.actor}};
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row=await this.persistence.get('connector_tokens',digest(request.token));
    if (row && JSON.parse(row.body as string).clientId===client.client_id) await this.persistence.remove('connector_tokens',digest(request.token),row.body);
  }
}
