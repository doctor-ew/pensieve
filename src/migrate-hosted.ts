import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {Pool,PoolClient} from 'pg';
import {transaction} from './postgres.js';
import {validateVector} from './embeddings.js';

type SourceKind='team'|'share'|'connector';
interface Table {source:SourceKind;name:string;columns:string[];key:string[]}
const table=(source:SourceKind,name:string,columns:string,key=columns):Table=>({source,name,columns:columns.split(','),key:key?key.split(','):[]});
// Dependency order matters: shares precede their team mapping, users precede memberships.
const tables:Table[]=[
 table('team','team_meta','key,value','key'),
 table('team','team_users','id,name,token,active','id'),
 table('team','team_access_identities','issuer,subject,actor','issuer,subject'),
 table('team','team_pools','id,name,visibility','id'),
 table('team','team_members','pool,actor,role','pool,actor'),
 table('team','team_memories','pool,id,body,contributor,created','pool,id'),
 table('team','team_origins','pool,id,origin,body','pool,id,origin'),
 table('team','team_vectors','pool,id,model,backend,vector','pool,id,model,backend'),
 table('share','shares','id,body,revoked','id'),
 table('team','team_shares','id,pool,creator,ids','id'),
 table('team','team_policies','actor,pool,scope,context,body','actor,pool,scope,context'),
 table('share','challenges','share,email,digest,expires,attempts,sent,window,sends','share,email'),
 table('share','access','digest,share,email,expires','digest'),
 table('share','revisions','share,saved,body',''),
 table('share','delivery_attempts','id,actor,share,email,status,created','id'),
 table('share','delivery_quota','scope,created',''),
 table('share','verification_limits','bucket,window,count','bucket'),
 table('connector','connector_clients','id,body','id'),
 table('connector','connector_pending','digest,body,expires','digest'),
 table('connector','connector_codes','digest,body,expires','digest'),
 table('connector','connector_tokens','digest,body,expires','digest'),
 table('connector','connector_families','digest,body,expires','digest'),
 table('connector','connector_refresh','digest,body,expires','digest'),
 table('connector','connector_revocations','digest,body,expires','digest')
];
const quote=(name:string)=>'"'+name+'"';
type Row=Record<string,SQLInputValue>;
export interface MigrationReceipt {
 sources:Partial<Record<SourceKind,{path:string;sha256:string}>>;
 tables:Record<string,{sourceRows:number;inserted:number;unchanged:number}>;
}
export interface HostedMigrationOptions {teamPath:string;sharePath:string;connectorPath?:string;pool:Pool}
async function fingerprint(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
function normalized(value:unknown,column:string):unknown {
 if(column==='vector'){
  const vector=typeof value==='string'?JSON.parse(value):value;validateVector(vector);
  // pgvector's vector type is float32; make this documented conversion deterministic.
  const result=(vector as number[]).map(Math.fround);if(result.some(v=>!Number.isFinite(v)))throw Error('Vector exceeds PostgreSQL float32 range');return result;
 }
 return typeof value==='bigint'?value.toString():value;
}
function equalRow(source:Row,destination:Record<string,unknown>,columns:string[]){return columns.every(column=>{
 const a=normalized(source[column],column),b=normalized(destination[column],column);
 if(column==='vector')return JSON.stringify(a)===JSON.stringify(b);
 return typeof a==='number'?Number(b)===a:a===b;
});}
async function importRow(client:PoolClient,spec:Table,row:Row,multiplicity:number){
 const columns=spec.columns,values=columns.map(column=>column==='vector'?JSON.stringify(normalized(row[column],column)):row[column]);
 const key=spec.key.length?spec.key:columns;
 const where=key.map((column,i)=>`${quote(column)} IS NOT DISTINCT FROM $${i+1}${column==='vector'?'::vector':''}`).join(' AND ');
 const keyValues=key.map(column=>column==='vector'?JSON.stringify(normalized(row[column],column)):row[column]);
 const selected=await client.query<Record<string,unknown>>(`SELECT ${columns.map(quote).join(',')} FROM ${quote(spec.name)} WHERE ${where}`,keyValues);
 if(spec.key.length&&selected.rows[0]&&!equalRow(row,selected.rows[0],columns))throw Error(`Destination conflict in ${spec.name}; import rolled back`);
 const existing=selected.rows.length;
 const missing=Math.max(0,multiplicity-existing);
 for(let i=0;i<missing;i++)await client.query(`INSERT INTO ${quote(spec.name)} (${columns.map(quote).join(',')}) VALUES (${columns.map((column,index)=>'$'+(index+1)+(column==='vector'?'::vector':'')).join(',')})`,values);
 return {inserted:missing,unchanged:Math.min(existing,multiplicity)};
}
/** Import maintenance-window backup copies only. Never changes or deletes source data. */
export async function migrateHosted(options:HostedMigrationOptions):Promise<MigrationReceipt>{
 const paths:Partial<Record<SourceKind,string>>={team:options.teamPath,share:options.sharePath,...(options.connectorPath?{connector:options.connectorPath}:{})};
 const opened:Partial<Record<SourceKind,DatabaseSync>>={};
 const receipt:MigrationReceipt={sources:{},tables:{}};
 try{
  for(const [kind,source] of Object.entries(paths) as [SourceKind,string][]){
   const path=resolve(source);if(!(await stat(path)).isFile())throw Error('Migration source must be a SQLite backup file');
   const wal=await stat(path+'-wal').catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
   if(wal&&wal.size)throw Error('Use a consistent SQLite backup copy, not a live WAL database');
   const db=new DatabaseSync(path,{readOnly:true});opened[kind]=db;db.exec('PRAGMA query_only=ON; BEGIN');
   const actual=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[];
   const allowed=tables.filter(t=>t.source===kind);
   for(const {name} of actual){
    const spec=allowed.find(t=>t.name===name);if(!spec)throw Error(`Unsupported ${kind} table ${name}; no data was imported`);
    const columns=db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c=>c.name as string);
    if(columns.length!==spec.columns.length||columns.some(c=>!spec.columns.includes(c)))throw Error(`Unsupported columns in ${name}; no data was imported`);
   }
   if(kind==='team'&&!actual.some(t=>t.name==='team_meta'))throw Error('Team source has no issuer metadata');
   if(kind==='share'&&!actual.some(t=>t.name==='shares'))throw Error('Share source has no snapshots table');
   receipt.sources[kind]={path,sha256:await fingerprint(path)};
  }
  await transaction(options.pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(727361916)');
   // No concurrent target writes may race conflict detection or issuer replacement.
   const destinationTables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename <> 'schema_migrations' ORDER BY tablename")).rows;
   for(const {tablename} of destinationTables)if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Unsupported destination table');
   await client.query('LOCK TABLE '+destinationTables.map(t=>quote(t.tablename)).join(',')+' IN SHARE ROW EXCLUSIVE MODE');
   const sourceIssuer=opened.team!.prepare("SELECT value FROM team_meta WHERE key='issuer'").get()?.value;
   if(typeof sourceIssuer!=='string'||!sourceIssuer)throw Error('Source server issuer is missing');
   const targetIssuer=(await client.query<{value:string}>("SELECT value FROM team_meta WHERE key='issuer'")).rows[0]?.value;
   if(targetIssuer&&targetIssuer!==sourceIssuer){
    const targetTables=(await client.query<{tablename:string}>("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('team_meta','schema_migrations')")).rows;
    for(const {tablename} of targetTables){if(!/^[a-z_][a-z0-9_]*$/.test(tablename))throw Error('Unsupported destination table');const populated=await client.query(`SELECT 1 FROM ${quote(tablename)} LIMIT 1`);if(populated.rows.length)throw Error('Destination issuer differs and database is not empty');}
    await client.query("UPDATE team_meta SET value=$1 WHERE key='issuer'",[sourceIssuer]);
   }
   for(const spec of tables){
    const db=opened[spec.source];if(!db||!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(spec.name))continue;
    const count={sourceRows:0,inserted:0,unchanged:0};receipt.tables[spec.name]=count;
    const grouping=spec.key.length?'':`,COUNT(*) AS "_multiplicity"`;
    const query=`SELECT ${spec.columns.map(quote).join(',')}${grouping} FROM ${quote(spec.name)}${spec.key.length?'':' GROUP BY '+spec.columns.map(quote).join(',')}`;
    for(const row of db.prepare(query).iterate() as Iterable<Row>){
     const multiplicity=spec.key.length?1:Number(row._multiplicity);const imported=await importRow(client,spec,row,multiplicity);
     count.sourceRows+=multiplicity;count.inserted+=imported.inserted;count.unchanged+=imported.unchanged;
    }
   }
   for(const source of Object.values(receipt.sources)){if(await fingerprint(source.path)!==source.sha256)throw Error('Source backup changed during import; rolled back');}
  });
  return receipt;
 }finally{for(const db of Object.values(opened)){try{db.exec('ROLLBACK');}finally{db.close();}}}
}
