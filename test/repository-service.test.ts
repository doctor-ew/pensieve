import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {TeamStore} from '../src/team-store.js';
import {LocalRepositoryRecords} from '../src/repository-records.js';
import {LocalRepositoryBlobs,validateSnapshot} from '../src/repository-artifacts.js';
import {RepositoryService} from '../src/repository-service.js';
import {RepositoryWorker} from '../src/repository-worker.js';
const file=(path:string,text:string)=>({path,content:Buffer.from(text).toString('base64'),sha256:createHash('sha256').update(text).digest('hex')});
test('uploaded repositories build real graphs and enforce pool boundaries for jobs and results',async()=>{
 const home=await mkdtemp(join(tmpdir(),'pensieve-repo-service-')),teams=new TeamStore(':memory:'),records=new LocalRepositoryRecords(join(home,'records.sqlite'));
 const service=new RepositoryService(teams,records,new LocalRepositoryBlobs(join(home,'blobs'))),worker=new RepositoryWorker(service,undefined,join(home,'work'));
 try{
  const alice=teams.createUser('Alice'),bob=teams.createUser('Bob'),reader=teams.createUser('Reader'),pool=teams.createPool(alice.user.id,'Code','shared');teams.grantMember(alice.user.id,pool.id,reader.user.id,'reader');
  const repo=await service.create(alice.user.id,{poolId:pool.id,name:'Fixture',source:{kind:'upload'},autoRefresh:true});
  await assert.rejects(service.authorized(bob.user.id,repo.id));await assert.rejects(service.beginUpload(reader.user.id,repo.id,'a'.repeat(40)));
  const upload=await service.beginUpload(alice.user.id,repo.id,'a'.repeat(40));await service.uploadFiles(alice.user.id,upload.uploadId,[file('math.ts','export function double(n:number){return n*2;}'),file('main.ts',"import {double} from './math.js'; export function calculate(n:number){return double(n);}")]);
  const build=await service.finishUpload(alice.user.id,upload.uploadId);await worker.process(build.id);const receipt=await service.job(alice.user.id,build.id);assert.equal(receipt.state,'succeeded');assert.equal(receipt.sourceRevision,'a'.repeat(40));
  await assert.rejects(service.job(bob.user.id,build.id));await assert.rejects(service.enqueue(reader.user.id,repo.id,{operation:'note',text:'No permission'}));
  const query=await service.enqueue(reader.user.id,repo.id,{operation:'callers',target:'double'});await worker.process(query.id);const answer=await service.job(reader.user.id,query.id);assert.equal(answer.state,'succeeded');assert.match(JSON.stringify(answer.result),/calculate/);assert.ok(!JSON.stringify(answer.result).includes(home));
  const saved=await service.enqueue(alice.user.id,repo.id,{operation:'note',text:'This repository uses the reviewed release process.'});await worker.process(saved.id);assert.equal((await service.job(alice.user.id,saved.id)).state,'succeeded');
  const recall=await service.enqueue(alice.user.id,repo.id,{operation:'recall',target:'release'});await worker.process(recall.id);assert.match(JSON.stringify((await service.job(alice.user.id,recall.id)).result),/reviewed release process/);
 }finally{records.close();teams.close();await rm(home,{recursive:true,force:true});}
});
test('source snapshots reject traversal, Git internals, duplicate names, secrets and digest changes',()=>{
 for(const path of ['../escape','/absolute','.git/config','.env','a/../../b','a\\b'])assert.throws(()=>validateSnapshot({version:1,revision:'a'.repeat(40),files:[file(path,'text')]}));
 const good=file('valid.ts','export const a=1;');assert.throws(()=>validateSnapshot({version:1,revision:'a'.repeat(40),files:[good,good]}));assert.throws(()=>validateSnapshot({version:1,revision:'a'.repeat(40),files:[{...good,sha256:'bad'}]}));
});
