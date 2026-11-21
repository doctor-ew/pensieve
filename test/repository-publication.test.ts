import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {TeamStore} from '../src/team-store.js';
import {TeamClient} from '../src/team-client.js';
import {createTeamServer} from '../src/team-server.js';
import {RepositoryService} from '../src/repository-service.js';
import {LocalRepositoryRecords} from '../src/repository-records.js';
import {LocalRepositoryBlobs} from '../src/repository-artifacts.js';
import {syncRepository} from '../src/repository-sync.js';
import type {EmbeddingProvider} from '../src/types.js';
const run=promisify(execFile);
const provider:EmbeddingProvider={identity:'synthetic-repository-test',embed:async texts=>texts.map(t=>[1,/double/.test(t)?1:0,/triple/.test(t)?1:0])};
test('real MEX producer publishes over HTTP; an independent consumer recalls only the active source revision',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pensieve-remote-knowledge-')),teams=new TeamStore(':memory:'),records=new LocalRepositoryRecords(join(home,'records.sqlite'));
 const service=new RepositoryService(teams,records,new LocalRepositoryBlobs(join(home,'blobs')),provider);
 const server=createTeamServer(teams,{ownerToken:'synthetic-test-operator-credential-32',publicUrl:'http://127.0.0.1:17339',provider,repositories:service});
 await new Promise<void>(resolve=>server.listen(17339,'127.0.0.1',resolve));
 try{
  const owner=teams.createUser('Producer'),reader=teams.createUser('Remote reader'),outsider=teams.createUser('Other pool'),pool=teams.createPool(owner.user.id,'Repository knowledge','shared');
  teams.grantMember(owner.user.id,pool.id,reader.user.id,'reader');
  const client=new TeamClient('http://127.0.0.1:17339',owner.token),consumer=new TeamClient('http://127.0.0.1:17339',reader.token);
  const repo=await service.create(owner.user.id,{poolId:pool.id,name:'Cross-device fixture',source:{kind:'upload'},autoRefresh:false});
  const source=join(home,'source');await mkdir(source);await run('git',['init',source]);
  const commit=async()=>{await run('git',['add','.'],{cwd:source});await run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture'],{cwd:source});};
  await writeFile(join(source,'math.ts'),'export function double(n:number){return n*2;}\n');await writeFile(join(source,'main.ts'),"import {double} from './math.js'; export function calculate(n:number){return double(n);}\n");await commit();
  const receipt=await syncRepository(client,repo.id,source) as {published:boolean;indexing:string};assert.equal(receipt.published,true);assert.equal(receipt.indexing,'complete');
  const hits=await consumer.search(pool.id,'double',8);assert.ok(hits.length);assert.match(hits.map(h=>h.text).join('\n'),/calls:.*double/);assert.ok(hits.every(h=>h.citations?.[0].includes('rev=')));assert.ok(!JSON.stringify(hits).includes(home));
  const original=(await service.authorized(reader.user.id,repo.id)).value.knowledge!;
  // A fresh producer stages a replacement. Existing readers retain the published snapshot.
  const staged=await service.publications.begin(owner.user.id,repo.id,'b'.repeat(40));
  const {score,...base}=hits[0];void score;
  await service.publications.append(owner.user.id,staged.publicationId,[{...base,id:'e'.repeat(64),session:staged.publicationId,citations:base.citations!.map(c=>c.replace(original.revision,'b'.repeat(40)))}]);
  for(let offset=0;offset<64;offset+=16)await service.publications.append(owner.user.id,staged.publicationId,Array.from({length:16},(_,i)=>({...base,id:createHash('sha256').update('staged-'+(offset+i)).digest('hex'),session:staged.publicationId,text:base.text+' staged '+(offset+i),citations:base.citations!.map(c=>c.replace(original.revision,'b'.repeat(40)))})));
  await teams.index(owner.user.id,pool.id,provider);
  assert.deepEqual((await consumer.search(pool.id,'double',8)).map(h=>h.id),hits.map(h=>h.id));
  await assert.rejects(service.publications.finish(reader.user.id,staged.publicationId));
  await assert.rejects(new TeamClient('http://127.0.0.1:17339',outsider.token).search(pool.id,'double',8));
  await writeFile(join(source,'math.ts'),'export function triple(n:number){return n*3;}\n');await rm(join(source,'main.ts'));await commit();
  await syncRepository(client,repo.id,source);
  const current=await consumer.search(pool.id,'triple',8);assert.ok(current.length);assert.ok(current.every(h=>!original.ids.includes(h.id)));assert.ok(current.every(h=>!h.text.includes('function double')&&!h.text.includes('calculate')));
  await assert.rejects(service.publications.finish(owner.user.id,staged.publicationId),/changed/);
  assert.equal((await service.status(reader.user.id,repo.id)).knowledge?.indexing,'complete');
  const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser=await chromium.launch({headless:true,executablePath:process.env.PENSIEVE_TEST_BROWSER??(existsSync(chrome)?chrome:undefined)});
  try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:17339/#token='+reader.token);await expect(page.locator('#workspace')).toBeVisible();await page.locator('#repository-panel summary').click();await page.locator('#load-repositories').click();await expect(page.locator('#repositories')).toContainText('Cross-device fixture');await expect(page.locator('#connect-repository')).toBeHidden();await page.getByRole('button',{name:'Check indexing',exact:true}).click();await expect(page.locator('#repositories')).toContainText('Search indexing: complete');assert.deepEqual(errors,[]);}finally{await browser.close();}

  // Removing every supported source file publishes an empty active snapshot.
  await rm(join(source,'math.ts'));await commit();await syncRepository(client,repo.id,source);
  assert.deepEqual(await consumer.search(pool.id,'triple',8),[]);
  await writeFile(join(source,'math.ts'),'export function triple(n:number){return n*3;}\n');await commit();await syncRepository(client,repo.id,source);
  // The producer checkout can disappear; consumers continue using remote memory.
  await rm(source,{recursive:true,force:true});assert.ok((await new TeamClient('http://127.0.0.1:17339',reader.token).search(pool.id,'triple',8)).length);
  teams.setPolicy(owner.user.id,pool.id,'team','',{destination:'off'});
  await assert.rejects(service.publications.begin(owner.user.id,repo.id,'c'.repeat(40)),/policy/);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));records.close();teams.close();await rm(home,{recursive:true,force:true});}
});
