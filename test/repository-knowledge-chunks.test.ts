import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {packedRepositoryKnowledge} from '../src/repository-knowledge-chunks.js';
import type {ConnectedRepository} from '../src/repository-service.js';
const repo={id:'11111111-1111-4111-8111-111111111111',name:'Large fixture'} as ConnectedRepository;
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE nodes(id TEXT,kind TEXT,name TEXT,qualified_name TEXT,file_path TEXT,start_line INTEGER,end_line INTEGER); CREATE TABLE edges(source TEXT,target TEXT,kind TEXT,confidence REAL,resolution_method TEXT);');return db;}
test('large graph preserves source, every symbol and inferred relationships in bounded deterministic records',()=>{
 const db=fixture();try{const insert=db.prepare('INSERT INTO nodes VALUES(?,?,?,?,?,?,?)');for(let i=0;i<4100;i++)insert.run(String(i),'function','symbol'+i,'symbol'+i,'large.ts',1,2);db.exec("INSERT INTO edges VALUES('0','4099','calls',0.8,'static')");
 const source='x'.repeat(12000)+'😀'+'y'.repeat(12000)+'\nlast line';const snapshot={version:1 as const,revision:'a'.repeat(40),files:[{path:'large.ts',content:Buffer.from(source).toString('base64'),sha256:'b'.repeat(64)}]};
 const records=packedRepositoryKnowledge(db,snapshot,repo,'publication');assert.ok(records.length>3&&records.length<4000);assert.ok(records.every(m=>m.text.length<=10000&&m.citations!.length<=100));assert.deepEqual(packedRepositoryKnowledge(db,snapshot,repo,'publication'),records);
 const text=records.map(m=>m.text).join('\n');for(let i=0;i<4100;i++)assert.ok(text.includes('symbol'+i));assert.match(text,/symbol0 L1 calls symbol4099/);assert.match(text,/confidence=0.8; resolution=static/);
 const recovered=records.map(m=>m.text.split(/\nSource: large.ts \(lines \d+-2\)\n/)[1]?.split('\nSymbols:')[0]??'').join('');assert.equal(recovered,source);assert.ok(records.every(m=>!/[\uD800-\uDBFF]$/.test(m.text)));assert.ok(records.every(m=>m.citations!.every(c=>c.includes('rev='+snapshot.revision))));
 db.exec("UPDATE nodes SET end_line=99 WHERE id='0'");assert.throws(()=>packedRepositoryKnowledge(db,snapshot,repo,'publication'),/does not match/);
 }finally{db.close();}
});
test('graph paths outside the committed snapshot fail closed',()=>{const db=fixture();try{db.exec("INSERT INTO nodes VALUES('x','file','secret','secret','../secret.ts',1,1)");assert.throws(()=>packedRepositoryKnowledge(db,{version:1,revision:'a'.repeat(40),files:[]},repo,'publication'),/does not match/);}finally{db.close();}});

test('idempotent publication retries are bounded and sign-in failures stop immediately',async()=>{
 const {retryPublication}=await import('../src/repository-sync.js');let attempts=0;const delays:number[]=[];
 assert.equal(await retryPublication(async()=>{if(++attempts<3)throw Error('temporary');return 'ok';},async ms=>{delays.push(ms);}), 'ok');assert.deepEqual(delays,[1000,2000]);
 attempts=0;await assert.rejects(retryPublication(async()=>{attempts++;throw Object.assign(Error('sign in'),{code:'SIGN_IN_REQUIRED'});},async()=>{}));assert.equal(attempts,1);
 attempts=0;await assert.rejects(retryPublication(async()=>{attempts++;throw Error('persistent');},async()=>{}));assert.equal(attempts,6);
});
