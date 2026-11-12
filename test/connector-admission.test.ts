import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {SqliteConnectorStorage,PgConnectorStorage,type ConnectorStorage} from '../src/connector-storage.js';
async function admission(storage:ConnectorStorage){
 let now=1700000000000;
 const insert=(key:string)=>storage.registerClient({table:'connector_clients',key,row:{body:JSON.stringify({client_id:key,client_id_issued_at:Math.floor(now/1000)})}},now);
 for(let batch=0;batch<10;batch++){for(let i=0;i<100;i++)await insert(`${batch}-${i}`);await assert.rejects(insert('overflow'),/capacity/);now+=61000;}
 await storage.insert({table:'connector_tokens',key:'active',row:{body:JSON.stringify({clientId:'0-0'}),expires:now+3*86400000}});
 await assert.rejects(insert('full'),/capacity/);
 now+=86400001;await insert('recovered');
 assert.ok(await storage.get('connector_clients','recovered'));assert.ok(await storage.get('connector_clients','0-0'));assert.equal(await storage.get('connector_clients','0-1'),undefined);
 now+=4*86400000;await insert('next');assert.equal(await storage.get('connector_clients','0-0'),undefined);
}
test('AC8 SQLite registration throttles bursts and reclaims inactive capacity',async()=>{const storage=new SqliteConnectorStorage(':memory:');try{await admission(storage);}finally{storage.close();}});
const connectionString=process.env.PENSIEVE_TEST_DATABASE_URL;
test('AC8 PostgreSQL registration throttles bursts and preserves active clients',{skip:!connectionString},async()=>{
 const admin=new Pool({connectionString}),schema='admission_'+randomBytes(8).toString('hex');await admin.query(`CREATE SCHEMA ${schema}`);const pool=new Pool({connectionString,options:`-c search_path=${schema},public`});
 try{for(const name of ['003-connector.sql','004-connector-refresh.sql'])await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));await admission(new PgConnectorStorage(pool));}finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
