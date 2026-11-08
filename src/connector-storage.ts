import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {transaction} from './postgres.js';

export type ConnectorTable='connector_clients'|'connector_pending'|'connector_codes'|'connector_tokens';
export interface ConnectorRow {body:string;expires?:number}
export interface ConnectorEntry {table:ConnectorTable;key:string;row:ConnectorRow}
/** Storage never sees raw credentials: callers pass only random-token digests. */
export interface ConnectorStorage {
 get(table:ConnectorTable,key:string):Promise<ConnectorRow|undefined>;
 insert(entry:ConnectorEntry,limit?:number):Promise<void>;
 registerClient(entry:ConnectorEntry,now:number):Promise<void>;
 prune(now:number):Promise<void>;
 consume(entry:ConnectorEntry,now:number,next?:ConnectorEntry):Promise<boolean>;
 remove(table:ConnectorTable,key:string,body:string):Promise<void>;
 close():void;
}
const keyColumn=(table:ConnectorTable)=>table==='connector_clients'?'id':'digest';
export class SqliteConnectorStorage implements ConnectorStorage {
 private readonly db:DatabaseSync;
 constructor(path:string){
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);
  this.db.exec(`PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS connector_clients(id TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS connector_pending(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS connector_codes(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS connector_tokens(digest TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS connector_pending_expiry ON connector_pending(expires);
   CREATE INDEX IF NOT EXISTS connector_codes_expiry ON connector_codes(expires);
   CREATE INDEX IF NOT EXISTS connector_tokens_expiry ON connector_tokens(expires);`);
 }
 async get(table:ConnectorTable,key:string){return this.db.prepare(`SELECT body${table==='connector_clients'?'':',expires'} FROM ${table} WHERE ${keyColumn(table)}=?`).get(key) as unknown as ConnectorRow|undefined;}
 private put({table,key,row}:ConnectorEntry){this.db.prepare(`INSERT INTO ${table} VALUES (${table==='connector_clients'?'?,?':'?,?,?'})`).run(...(table==='connector_clients'?[key,row.body]:[key,row.body,row.expires!]));}
 async insert(entry:ConnectorEntry,limit?:number){
  this.db.exec('BEGIN IMMEDIATE');try{
   if(limit!==undefined&&Number(this.db.prepare(`SELECT COUNT(*) n FROM ${entry.table}`).get()!.n)>=limit)throw Error('Connector capacity reached');
   this.put(entry);this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 async registerClient(entry:ConnectorEntry,now:number){
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare(`DELETE FROM connector_clients WHERE COALESCE(json_extract(body,'$.client_id_issued_at'),0)<=? AND NOT EXISTS (SELECT 1 FROM connector_pending WHERE expires>? AND json_extract(connector_pending.body,'$.clientId')=connector_clients.id) AND NOT EXISTS (SELECT 1 FROM connector_codes WHERE expires>? AND json_extract(connector_codes.body,'$.clientId')=connector_clients.id) AND NOT EXISTS (SELECT 1 FROM connector_tokens WHERE expires>? AND json_extract(connector_tokens.body,'$.clientId')=connector_clients.id)`).run(Math.floor((now-86400000)/1000),now,now,now);
   const counts=this.db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN json_extract(body,'$.client_id_issued_at')>? THEN 1 ELSE 0 END) recent FROM connector_clients").get(Math.floor((now-60000)/1000))!;
   if(Number(counts.total)>=1000||Number(counts.recent)>=100)throw Error('Connector registration capacity reached; try again later');
   this.put(entry);this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 async prune(now:number){for(const table of ['connector_pending','connector_codes','connector_tokens'])this.db.prepare(`DELETE FROM ${table} WHERE expires<=?`).run(now);}
 async consume(entry:ConnectorEntry,now:number,next?:ConnectorEntry){
  this.db.exec('BEGIN IMMEDIATE');try{
   const removed=this.db.prepare(`DELETE FROM ${entry.table} WHERE ${keyColumn(entry.table)}=? AND body=? AND expires>?`).run(entry.key,entry.row.body,now);
   if(removed.changes!==1){this.db.exec('ROLLBACK');return false;}
   if(next)this.put(next);this.db.exec('COMMIT');return true;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 async remove(table:ConnectorTable,key:string,body:string){this.db.prepare(`DELETE FROM ${table} WHERE ${keyColumn(table)}=? AND body=?`).run(key,body);}
 close(){this.db.close();}
}
export class PgConnectorStorage implements ConnectorStorage {
 constructor(private readonly pool:Pool){}
 async get(table:ConnectorTable,key:string){
  const {rows}=await this.pool.query<{body:string;expires?:string|number}>(`SELECT body${table==='connector_clients'?'':',expires'} FROM ${table} WHERE ${keyColumn(table)}=$1`,[key]);
  return rows[0]?{body:rows[0].body,...(rows[0].expires===undefined?{}:{expires:Number(rows[0].expires)})}:undefined;
 }
 private async put(client:PoolClient,{table,key,row}:ConnectorEntry){await client.query(`INSERT INTO ${table} VALUES (${table==='connector_clients'?'$1,$2':'$1,$2,$3'})`,table==='connector_clients'?[key,row.body]:[key,row.body,row.expires]);}
 async insert(entry:ConnectorEntry,limit?:number){await transaction(this.pool,async client=>{
  if(limit!==undefined){
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['pensieve:'+entry.table]);
   const {rows}=await client.query<{n:string}>(`SELECT COUNT(*) n FROM ${entry.table}`);
   if(Number(rows[0].n)>=limit)throw Error('Connector capacity reached');
  }
  await this.put(client,entry);
 });}
 async registerClient(entry:ConnectorEntry,now:number){await transaction(this.pool,async client=>{
  // Serialize admission and exclude grant mutations while checking active references.
  await client.query('LOCK TABLE connector_clients,connector_pending,connector_codes,connector_tokens IN SHARE ROW EXCLUSIVE MODE');
  await client.query(`DELETE FROM connector_clients WHERE COALESCE((body::jsonb->>'client_id_issued_at')::bigint,0)<=$1 AND NOT EXISTS (SELECT 1 FROM connector_pending WHERE expires>$2 AND connector_pending.body::jsonb->>'clientId'=connector_clients.id) AND NOT EXISTS (SELECT 1 FROM connector_codes WHERE expires>$2 AND connector_codes.body::jsonb->>'clientId'=connector_clients.id) AND NOT EXISTS (SELECT 1 FROM connector_tokens WHERE expires>$2 AND connector_tokens.body::jsonb->>'clientId'=connector_clients.id)`,[Math.floor((now-86400000)/1000),now]);
  const counts=(await client.query<{total:string;recent:string}>("SELECT COUNT(*) total,COUNT(*) FILTER (WHERE (body::jsonb->>'client_id_issued_at')::bigint>$1) recent FROM connector_clients",[Math.floor((now-60000)/1000)])).rows[0];
  if(Number(counts.total)>=1000||Number(counts.recent)>=100)throw Error('Connector registration capacity reached; try again later');
  await this.put(client,entry);
 });}
 async prune(now:number){for(const table of ['connector_pending','connector_codes','connector_tokens'])await this.pool.query(`DELETE FROM ${table} WHERE expires<=$1`,[now]);}
 async consume(entry:ConnectorEntry,now:number,next?:ConnectorEntry){return transaction(this.pool,async client=>{
  const removed=await client.query(`DELETE FROM ${entry.table} WHERE ${keyColumn(entry.table)}=$1 AND body=$2 AND expires>$3 RETURNING ${keyColumn(entry.table)}`,[entry.key,entry.row.body,now]);
  if(removed.rowCount!==1)return false;
  if(next)await this.put(client,next);return true;
 });}
 async remove(table:ConnectorTable,key:string,body:string){await this.pool.query(`DELETE FROM ${table} WHERE ${keyColumn(table)}=$1 AND body=$2`,[key,body]);}
 close(){} // Pool belongs to the application, not this adapter.
}
