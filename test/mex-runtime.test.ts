import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MexRuntime,MexRuntimeError} from '../src/mex-runtime.js';
const execute=promisify(execFile);
async function fixture(){const home=await mkdtemp(join(tmpdir(),'pensieve-mex-contract-')),repo=join(home,'repo'),state=join(home,'state');await mkdir(repo);await execute('git',['init',repo]);await writeFile(join(repo,'math.ts'),'export function double(value:number){return value*2;}\n');await writeFile(join(repo,'main.ts'),"import {double} from './math.js';\nexport function calculate(value:number){return double(value)+1;}\n");return {home,repo,state,engine:new MexRuntime(),close:()=>rm(home,{recursive:true,force:true})};}
test('real pinned MEX builds call graph, queries callers and refuses stale evidence',async()=>{
 const f=await fixture();try{
  const built=await f.engine.run(f.repo,f.state,{operation:'build'});assert.equal(built.exitCode,0);assert.ok(JSON.stringify(built.records).includes('edgesCreated'));
  const callers=await f.engine.run(f.repo,f.state,{operation:'callers',target:'double'});assert.match(JSON.stringify(callers.records),/calculate/);
  const impact=await f.engine.run(f.repo,f.state,{operation:'impact',target:'double'});assert.match(JSON.stringify(impact.records),/calculate/);
  const defs=await f.engine.run(f.repo,f.state,{operation:'definitions',target:'double'});assert.match(JSON.stringify(defs.records),/math.ts/);
  await writeFile(join(f.repo,'math.ts'),'export function triple(value:number){return value*3;}\n');
  const stale=await f.engine.run(f.repo,f.state,{operation:'status'});assert.match(JSON.stringify(stale.records),/stale/);
  await f.engine.run(f.repo,f.state,{operation:'refresh'});
  const refreshed=await f.engine.run(f.repo,f.state,{operation:'definitions',target:'triple'});assert.match(JSON.stringify(refreshed.records),/triple/);
 }finally{await f.close();}
});
test('notes persist in isolated tenant state and preserve corrections and retirement',async()=>{
 const f=await fixture();try{
  const saved=await f.engine.run(f.repo,f.state,{operation:'note',text:'Use the documented release checklist.'});
  const record=saved.records[0] as {entry:{mex:{id:string}}};const id=record.entry.mex.id;assert.ok(id);
  assert.match(JSON.stringify((await new MexRuntime().run(f.repo,f.state,{operation:'recall',target:'release'})).records),/release checklist/);
  const another=await f.engine.run(f.repo,join(f.home,'other-account'),{operation:'recall',target:'release'});assert.ok(!JSON.stringify(another.records).includes('release checklist'));
  await f.engine.run(f.repo,f.state,{operation:'edit',target:id,text:'Use the reviewed release checklist.'});
  await f.engine.run(f.repo,f.state,{operation:'retire',target:id,text:'Replaced by project release policy.'});
  const report=await f.engine.run(f.repo,f.state,{operation:'check'});assert.ok(report.records.length);
 }finally{await f.close();}
});
test('unsupported operations, invalid limits, cancellation and process deadline fail closed',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.engine.run(f.repo,f.state,{operation:'shell' as never}),MexRuntimeError);
  await assert.rejects(f.engine.run(f.repo,f.state,{operation:'scope',target:'x',limit:100000}),MexRuntimeError);
  const abort=new AbortController();abort.abort();await assert.rejects(f.engine.run(f.repo,f.state,{operation:'build'},{signal:abort.signal}),{code:'CANCELLED'});
  await assert.rejects(f.engine.run(f.repo,f.state,{operation:'build'},{timeoutMs:1}),{code:'TIMEOUT'});
 }finally{await f.close();}
});
