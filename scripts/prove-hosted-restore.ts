/** Disposable restore proof. Requires PostgreSQL client tools matching the server. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {postgresPool,migratePostgres} from '../src/postgres.js';
import {PgTeamStore} from '../src/pg-team-store.js';
import {PgShareStore} from '../src/pg-share-store.js';
import {PgHostedSessions} from '../src/hosted-sessions.js';
import {makeMemory} from '../src/sessions.js';
const run=promisify(execFile);
const base=process.env.PENSIEVE_TEST_DATABASE_URL;
if(!base)throw Error('Set PENSIEVE_TEST_DATABASE_URL to a disposable local PostgreSQL instance');
const admin=postgresPool(base),suffix=randomBytes(6).toString('hex');
const names=[`restore_source_${suffix}`,`restore_target_${suffix}`];
const dir=await mkdtemp(join(tmpdir(),'pensieve-restore-'));
const urls=names.map(name=>{const u=new URL(base);u.pathname='/'+name;return u.href;});
const pools=urls.map(url=>postgresPool(url));
try{
 for(const name of names)await admin.query(`CREATE DATABASE ${name}`);
 const [source,target]=pools;await migratePostgres(source);
 const store=await PgTeamStore.open(source),user=await store.createUser('Restore fixture');
 const pool=await store.createPool(user.user.id,'Restore fixture','private');
 const memory=makeMemory({text:'A restore must retain authorization and memory provenance.',source:'manual',session:'restore',role:'user',timestamp:'',locator:'fixture',project:'restore'});
 await store.putMemory(user.user.id,pool.id,memory);
 const provider={identity:'restore:test',embed:async(texts:string[])=>texts.map(()=>[1,0])};
 await store.index(user.user.id,pool.id,provider);
 const bundle=await store.exportBundle(user.user.id,pool.id,[memory.id]);
 const shares=new PgShareStore(source),snapshot=await store.createShare(user.user.id,pool.id,{title:'Restore fixture',brief:'Restore proof',recipients:['friend@example.com'],days:7,cloudAllowed:false,bundle,accessMode:'invitation-link',ids:[memory.id]});
 const grant=await shares.invitation(snapshot.id,'friend@example.com');
 const session=await new PgHostedSessions(source).create(user.user.id);
 const dump=join(dir,'backup.dump');
 await run('pg_dump',['--dbname',urls[0],'--format=custom','--no-owner','--file',dump]);
 await run('pg_restore',['--dbname',urls[1],'--no-owner','--exit-on-error',dump]);
 const digest=async(db:typeof source)=>{
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const data=[];
  for(const {tablename} of tables){assert.match(tablename,/^[a-z_]+$/);const rows=(await db.query(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t ORDER BY row_to_json(t)::text`)).rows;data.push([tablename,rows]);}
  return {tables:tables.length,sha256:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
 };
 const before=await digest(source);assert.deepEqual(await digest(target),before);
 const restored=await PgTeamStore.open(target);
 assert.equal((await restored.authenticate(user.token)).id,user.user.id);
 const exported=await restored.exportBundle(user.user.id,pool.id,[memory.id]);
 assert.deepEqual(exported.memories,bundle.memories);assert.deepEqual(exported.provenance,bundle.provenance);
 assert.equal((await new PgShareStore(target).authorize(snapshot.id,grant)).id,snapshot.id);
 assert.equal((await new PgHostedSessions(target).get(session))?.userId,user.user.id);
 assert.equal((await restored.search(user.user.id,pool.id,'restore',provider,1))[0].id,memory.id);
 console.log(JSON.stringify({result:'PASS',...before,checks:['all table rows identical','personal credential','provenance','share grant','durable session','vector recall']}));
}finally{
 for(const pool of pools)await pool.end();
 for(const name of names)await admin.query(`DROP DATABASE IF EXISTS ${name}`);
 await admin.end();await rm(dir,{recursive:true,force:true});
}
