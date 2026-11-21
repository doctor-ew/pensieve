import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {committedRepositorySnapshot,syncRepository} from '../src/repository-sync.js';
import {repositoryKnowledge} from '../src/repository-knowledge.js';
import type {ConnectedRepository} from '../src/repository-service.js';
const run=promisify(execFile);
test('committed Markdown and Swift publish without MEX; receipts enumerate every exclusion and preserve revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pensieve-coverage-'));try{
  await run('git',['init',root]);await mkdir(join(root,'.private'));await writeFile(join(root,'HISTORY.md'),'# Release decision\nUse channel startup gating.\n');await writeFile(join(root,'Startup.swift'),'func startChannel() { print("ready") }\n');await writeFile(join(root,'image.png'),Buffer.from([0,1,2]));await writeFile(join(root,'.private','note.md'),'Excluded private directory');await symlink('HISTORY.md',join(root,'linked.md'));
  await run('git',['add','.'],{cwd:root});await run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','-m','fixture'],{cwd:root});await writeFile(join(root,'HISTORY.md'),'UNCOMMITTED must not upload');
  const snapshot=await committedRepositorySnapshot(root);assert.equal(snapshot.files.length,2);assert.equal(snapshot.coverage.tracked,5);assert.equal(snapshot.coverage.semantic,0);assert.equal(snapshot.coverage.citedText,2);assert.deepEqual(new Set(snapshot.coverage.skipped.map(x=>x.reason)),new Set(['non-file','excluded-directory','unsupported-extension']));
  const repo={id:'11111111-1111-4111-8111-111111111111',name:'Fallback fixture',source:{kind:'upload'}} as ConnectedRepository;
  const memories=repositoryKnowledge(root,snapshot,repo,'publication');const body=memories.map(m=>m.text).join('\n');assert.match(body,/startChannel/);assert.match(body,/Use channel startup gating/);assert.match(body,/no symbol extraction/);assert.match(body,/unsupported-extension/);assert.ok(!body.includes('UNCOMMITTED'));assert.ok(memories.flatMap(m=>m.citations!).some(c=>c.includes('Startup.swift')&&c.includes(snapshot.revision)));
  const calls:string[]=[];let version=1;
  const client={async request<T>(path:string,input?:unknown):Promise<T>{calls.push(path);if(path==='repositories/get')return {...repo,knowledge:{revision:snapshot.revision,formatVersion:version}} as T;if(path==='repositories/begin-publication'){assert.equal((input as {formatVersion:number}).formatVersion,2);return {publicationId:'22222222-2222-4222-8222-222222222222'} as T;}if(path==='repositories/finish-publication')return {published:true} as T;return {accepted:1} as T;}};
  const result=await syncRepository(client,repo.id,root);assert.ok(calls.includes('repositories/append-publication'));assert.deepEqual(result.coverage,snapshot.coverage);version=2;calls.length=0;assert.equal((await syncRepository(client,repo.id,root)).alreadyCurrent,true);assert.deepEqual(calls,['repositories/get']);
 }finally{await rm(root,{recursive:true,force:true});}
});
