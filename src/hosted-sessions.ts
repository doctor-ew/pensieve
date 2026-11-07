import {createHash,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {transaction} from './postgres.js';
import {TeamAccessError,type TeamUser} from './team-store.js';
import type {CognitoIdentity,LoginState,LoginStates} from './cognito.js';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export interface HostedSession { userId:string; identity?:CognitoIdentity }
export interface HostedSessions {
  create(userId:string,identity?:CognitoIdentity):Promise<string>;
  get(token:string):Promise<HostedSession|undefined>;
  destroy(token:string):Promise<void>;
  revokeUser(userId:string):Promise<void>;
  linkIdentity(identity:CognitoIdentity,personalToken:string):Promise<TeamUser>;
}
/** Expiring login secrets never leave this server-side repository. */
export class PgLoginStates implements LoginStates {
  constructor(private readonly pool:Pool,private readonly now=Date.now) {}
  async put(state:LoginState):Promise<void> {
    await transaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(727361918)');
      await client.query('DELETE FROM cognito_login_states WHERE expires<=$1',[this.now()]);
      await client.query('DELETE FROM cognito_login_states WHERE digest IN (SELECT digest FROM cognito_login_states WHERE browser=$1 ORDER BY created DESC,digest DESC OFFSET 4)',[state.browser]);
      const count=await client.query<{n:string}>('SELECT count(*) n FROM cognito_login_states');
      if(Number(count.rows[0].n)>=5000)throw Error('Sign-in capacity reached; try again shortly');
      await client.query('INSERT INTO cognito_login_states(digest,browser,verifier,nonce,return_to,expires,created) VALUES($1,$2,$3,$4,$5,$6,$7)',[state.digest,state.browser,state.verifier,state.nonce,state.returnTo,state.expires,this.now()]);
    });
  }
  async take(hash:string,browser:string,now:number):Promise<LoginState|undefined> {
    const result=await this.pool.query<{digest:string;browser:string;verifier:string;nonce:string;return_to:string;expires:string}>('DELETE FROM cognito_login_states WHERE digest=$1 AND browser=$2 AND expires>$3 RETURNING digest,browser,verifier,nonce,return_to,expires',[hash,browser,now]);
    const row=result.rows[0];return row?{digest:row.digest,browser:row.browser,verifier:row.verifier,nonce:row.nonce,returnTo:row.return_to,expires:Number(row.expires)}:undefined;
  }
}
/** Durable opaque browser sessions are independent of identity-provider tokens. */
export class PgHostedSessions implements HostedSessions {
  constructor(private readonly pool:Pool,private readonly now=Date.now) {}
  async create(userId:string,identity?:CognitoIdentity):Promise<string> {
    const token=randomBytes(32).toString('hex');
    await transaction(this.pool,async client=>{
      const user=await client.query('SELECT id FROM team_users WHERE id=$1 AND active=1 FOR UPDATE',[userId]);
      if(!user.rows.length)throw new TeamAccessError(401,'Unauthorized identity');
      if(identity){
        const mapping=await client.query('SELECT actor FROM team_access_identities WHERE issuer=$1 AND subject=$2 AND actor=$3',[identity.issuer,identity.subject,userId]);
        if(!mapping.rows.length)throw new TeamAccessError(401,'Identity does not belong to this account');
      }
      await client.query('DELETE FROM hosted_sessions WHERE actor=$1 AND expires<=$2',[userId,this.now()]);
      await client.query('DELETE FROM hosted_sessions WHERE digest IN (SELECT digest FROM hosted_sessions WHERE actor=$1 ORDER BY created DESC,digest DESC OFFSET 4)',[userId]);
      await client.query('INSERT INTO hosted_sessions(digest,actor,identity,expires,created) VALUES($1,$2,$3,$4,$5)',[digest(token),userId,identity?JSON.stringify(identity):null,this.now()+43_200_000,this.now()]);
    });return token;
  }
  async get(token:string):Promise<HostedSession|undefined> {
    if(!/^[a-f0-9]{64}$/.test(token))return;
    const result=await this.pool.query<{actor:string;identity:CognitoIdentity|null}>(`SELECT s.actor,s.identity FROM hosted_sessions s JOIN team_users u ON u.id=s.actor AND u.active=1 WHERE s.digest=$1 AND s.expires>$2 AND (s.identity IS NULL OR EXISTS(SELECT 1 FROM team_access_identities i WHERE i.issuer=s.identity->>'issuer' AND i.subject=s.identity->>'subject' AND i.actor=s.actor))`,[digest(token),this.now()]);
    const row=result.rows[0];return row?{userId:row.actor,...(row.identity?{identity:row.identity}:{})}:undefined;
  }
  async destroy(token:string):Promise<void> { if(/^[a-f0-9]{64}$/.test(token))await this.pool.query('DELETE FROM hosted_sessions WHERE digest=$1',[digest(token)]); }
  async revokeUser(userId:string):Promise<void> { await this.pool.query('DELETE FROM hosted_sessions WHERE actor=$1',[userId]); }
  async linkIdentity(identity:CognitoIdentity,personalToken:string):Promise<TeamUser> {
    if(typeof personalToken!=='string'||!personalToken||personalToken.length>512||!identity.issuer||!identity.subject||!identity.email)throw new TeamAccessError(401,'Both account credentials are required');
    return transaction(this.pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[JSON.stringify([identity.issuer,identity.subject])]);
      const result=await client.query<TeamUser>('SELECT id,name FROM team_users WHERE token=$1 AND active=1 FOR UPDATE',[digest(personalToken)]);
      const user=result.rows[0];if(!user)throw new TeamAccessError(401,'Invalid personal credential');
      const existing=await client.query<{actor:string}>('SELECT actor FROM team_access_identities WHERE issuer=$1 AND subject=$2 FOR UPDATE',[identity.issuer,identity.subject]);
      const previous=existing.rows[0]?.actor;
      if(previous&&previous!==user.id){
        await client.query('SELECT id FROM team_users WHERE id=$1 FOR UPDATE',[previous]);
        const used=await client.query<{used:boolean}>(`SELECT EXISTS(SELECT 1 FROM team_members WHERE actor=$1 UNION ALL SELECT 1 FROM team_memories WHERE contributor=$1 UNION ALL SELECT 1 FROM team_shares WHERE creator=$1 UNION ALL SELECT 1 FROM team_policies WHERE actor=$1) used`,[previous]);
        if(used.rows[0].used)throw new TeamAccessError(403,'This signed-in account has existing data; linking would hide it. Export or transfer it before linking.');
        await client.query('DELETE FROM hosted_sessions WHERE actor=$1',[previous]);
      }
      await client.query('INSERT INTO team_access_identities(issuer,subject,actor) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE SET actor=excluded.actor',[identity.issuer,identity.subject,user.id]);
      return user;
    });
  }
}
