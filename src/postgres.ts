import {Pool,type PoolClient,type PoolConfig} from 'pg';
import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export type PgQuery = Pick<Pool,'query'>;
export function postgresPool(connectionString:string,options:PoolConfig={}):Pool {
 const url=new URL(connectionString);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('PostgreSQL connection URL required');
 return new Pool({connectionString,max:10,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,...options});
}
export async function transaction<T>(pool:Pool,action:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await action(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
/** Migration checksums prevent silently mutating already deployed schemas. */
export async function migratePostgres(pool:Pool,directory:URL=new URL('../migrations/',import.meta.url)):Promise<void>{
 await transaction(pool,async client=>{
  await client.query('SELECT pg_advisory_xact_lock(727361916)');
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files=(await readdir(directory)).filter(name=>/^\d+-?[\w-]*\.sql$/.test(name)).sort();
  if(!files.length)throw Error('No PostgreSQL migrations found');
  for(const name of files){const sql=await readFile(new URL(name,directory),'utf8');const checksum=createHash('sha256').update(sql).digest('hex');
   const prior=await client.query<{checksum:string}>('SELECT checksum FROM schema_migrations WHERE version=$1',[name]);
   if(prior.rows.length){if(prior.rows[0].checksum!==checksum)throw Error(`Migration checksum changed: ${name}`);continue;}
   await client.query(sql);await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[name,checksum]);
  }
 });
}
