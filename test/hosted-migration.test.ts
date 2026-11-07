import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {postgresPool,migratePostgres} from '../src/postgres.js';
import {TeamStore} from '../src/team-store.js';
import {ShareStore} from '../src/executive.js';
import {PgTeamStore} from '../src/pg-team-store.js';
import {PgShareStore} from '../src/pg-share-store.js';
import {SqliteConnectorStorage,PgConnectorStorage} from '../src/connector-storage.js';
import {migrateHosted} from '../src/migrate-hosted.js';
import {makeMemory} from '../src/sessions.js';
const databaseUrl=process.env.PENSIEVE_TEST_DATABASE_URL;
test('AC9 maintenance snapshot import preserves access, vectors, provenance and rolls back conflicts',{skip:!databaseUrl},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'pensieve-migrate-'));
 const teamPath=join(directory,'team.sqlite'),sharePath=join(directory,'share.sqlite'),connectorPath=join(directory,'connector.sqlite');
 const local=new TeamStore(teamPath),share=new ShareStore(sharePath),connector=new SqliteConnectorStorage(connectorPath);
 const alice=local.createUser('Alice'),poolRecord=local.createPool(alice.user.id,'Migration','shared');
 const memory=makeMemory({text:'Preserve decisions',source:'manual',session:'fixture',role:'user',timestamp:'',locator:'fixture',project:'fixture'});
 local.putMemory(alice.user.id,poolRecord.id,memory);
 const provider={identity:'migration:two',embed:async(texts:string[])=>texts.map(()=>[0.1,0.2])};await local.index(alice.user.id,poolRecord.id,provider);
 const bundle=local.exportBundle(alice.user.id,poolRecord.id,[memory.id]);
 const snapshot=share.create({title:'Migration fixture',brief:'Reviewed decisions',recipients:['friend@example.com'],days:7,cloudAllowed:false,bundle,accessMode:'invitation-link'});
 local.recordShare(alice.user.id,poolRecord.id,snapshot.id,[memory.id]);const token=share.invitation(snapshot.id,'friend@example.com');
 share.db.exec('CREATE TABLE delivery_quota(scope TEXT NOT NULL,created INTEGER NOT NULL); INSERT INTO delivery_quota VALUES (\'fixture\',1),(\'fixture\',1)');
 await connector.insert({table:'connector_tokens',key:'fixture-hash',row:{body:'{"fixture":true}',expires:Date.now()+60000}});
 const issuer=local.sourceServer;local.close();share.close();connector.close();
 const admin=postgresPool(databaseUrl!),name='migration_'+randomBytes(6).toString('hex');await admin.query(`CREATE DATABASE ${name}`);const url=new URL(databaseUrl!);url.pathname='/'+name;const pool=postgresPool(url.href);
 try{
  await migratePostgres(pool);await PgTeamStore.open(pool);
  const options={teamPath,sharePath,connectorPath,pool};
  await t.test('AC9 original credentials, snapshots, issuer and vector conversion survive',async()=>{
   const result=await migrateHosted(options);assert.equal(result.tables.team_memories.inserted,1);assert.match(result.sources.team!.sha256,/^[a-f0-9]{64}$/);
   const pg=await PgTeamStore.open(pool);assert.equal(pg.sourceServer,issuer);assert.deepEqual(await pg.authenticate(alice.token),alice.user);
   const exported=await pg.exportBundle(alice.user.id,poolRecord.id,[memory.id]);assert.deepEqual(exported.memories,bundle.memories);assert.deepEqual(exported.provenance,bundle.provenance);
   assert.equal((await new PgShareStore(pool).authorize(snapshot.id,token)).id,snapshot.id);
   assert.equal((await pg.search(alice.user.id,poolRecord.id,'decisions',provider,1))[0].id,memory.id);
   assert.deepEqual(await new PgConnectorStorage(pool).get('connector_tokens','fixture-hash'),{body:'{"fixture":true}',expires:Number((await pool.query('SELECT expires FROM connector_tokens')).rows[0].expires)});
  });
  await t.test('AC9 replay is idempotent including duplicate quota rows',async()=>{
   const result=await migrateHosted(options);assert.ok(Object.values(result.tables).every(table=>table.inserted===0));assert.equal(result.tables.delivery_quota.unchanged,2);
  });
  await t.test('AC9 late conflict rolls back earlier inserts',async()=>{
   const source=new TeamStore(teamPath);const added=source.createUser('New before conflict');source.close();
   await pool.query("UPDATE team_memories SET body='conflicting' WHERE id=$1",[memory.id]);
   await assert.rejects(migrateHosted(options),/conflict/);assert.equal((await pool.query('SELECT id FROM team_users WHERE id=$1',[added.user.id])).rowCount,0);
   await pool.query('UPDATE team_memories SET body=$2 WHERE id=$1',[memory.id,JSON.stringify(memory)]);
  });
  await t.test('AC9 unknown source columns are rejected',async()=>{
   const source=new DatabaseSync(connectorPath);source.exec('ALTER TABLE connector_clients ADD COLUMN unknown TEXT');source.close();await assert.rejects(migrateHosted(options),/Unsupported columns/);
  });
  await t.test('AC9 populated destination cannot replace issuer',async()=>{
   await pool.query("UPDATE team_meta SET value='another' WHERE key='issuer'");await assert.rejects(migrateHosted({teamPath,sharePath,pool}),/issuer differs/);
  });
 }finally{await pool.end();await admin.query(`DROP DATABASE ${name}`);await admin.end();await rm(directory,{recursive:true,force:true});}
});
