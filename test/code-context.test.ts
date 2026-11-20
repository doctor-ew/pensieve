import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CodeContext,extractCode,publishCode} from '../src/code-context.js';
import {validateMemoryRecord} from '../src/memory-record.js';
import {TeamStore} from '../src/team-store.js';
import {TeamClient} from '../src/team-client.js';
import {createTeamServer} from '../src/team-server.js';
import {remoteAgentServer} from '../src/team-service.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createApp} from '../src/server.js';
import {Store} from '../src/store.js';
import {chromium,expect} from '@playwright/test';
const exec=promisify(execFile);
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'pensieve-code-')),root=join(dir,'repo'),home=join(dir,'home');await mkdir(root);
 const git=(...args:string[])=>exec('git',args,{cwd:root});
 await git('init','-q');await git('config','user.name','Synthetic Test');await git('config','user.email','test@example.invalid');
 await writeFile(join(root,'auth.ts'),'export function authenticate(token: string) { return token.length > 0; }\nexport function logout() { return true; }\n');
 await writeFile(join(root,'secret.env'),'PRIVATE=never-index');await mkdir(join(root,'.hidden'));await writeFile(join(root,'.hidden','secret.ts'),'export const secret = "excluded";');
 await symlink('/etc/passwd',join(root,'external.ts'));
 await git('add','.');await git('commit','-qm','Synthetic code');const context=new CodeContext(home);
 return {dir,root,home,git,context,close:async()=>{context.close();await rm(dir,{recursive:true,force:true});}};
}
test('MEX-derived symbol identity survives line shifts and distinguishes scopes',()=>{
 const code='class A { run() { return 1; } }\nclass B { run() { return 2; } }';
 const before=extractCode('app.ts',code),after=extractCode('app.ts','// comment\n'+code);
 assert.deepEqual(before.map(s=>s.id),after.map(s=>s.id));assert.notEqual(before.find(s=>s.name==='A.run')!.id,before.find(s=>s.name==='B.run')!.id);
 assert.equal(after[0].startLine,before[0].startLine+1);
});
test('indexing uses committed regular source files, marks drift, and replaces deleted symbols atomically',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.root,'auth.ts'),'export function dirtySecret() { return "not committed"; }');
  await writeFile(join(f.root,'untracked.ts'),'export const untrackedSecret = true;');
  const snapshot=await f.context.index(f.root);assert.equal(snapshot.files,1);assert.equal(snapshot.symbols,2);
  const hits=f.context.search(snapshot.id,'authenticate');assert.equal(hits[0].name,'authenticate');assert.match(hits[0].citation,/rev=/);
  assert.equal(f.context.search(snapshot.id,'dirtySecret').length,0);assert.equal(f.context.search(snapshot.id,'untrackedSecret').length,0);
  assert.equal((await f.context.status(snapshot.id)).uncommittedChanges,true);
  const memory=f.context.memories(snapshot.id,[hits[0].id])[0];validateMemoryRecord(memory);assert.ok(!JSON.stringify(memory).includes(f.root));
  await f.git('add','auth.ts');await f.git('commit','-qm','Change code');assert.equal((await f.context.status(snapshot.id)).stale,true);
  await f.context.index(f.root);assert.equal(f.context.search(snapshot.id,'authenticate').length,0);assert.equal(f.context.search(snapshot.id,'dirtySecret')[0].name,'dirtySecret');
  assert.throws(()=>f.context.memories(snapshot.id,[]),/Explicitly select/);assert.throws(()=>f.context.memories(snapshot.id,['missing']),/not in this repository/);
 }finally{await f.close();}
});
test('exact method matches rank above local variables in the method scope',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.root,'auth.ts'),'export class Store { rotatePersonalToken() { const token = "synthetic"; const digest = token.length; return {token, digest}; } }');
  await f.git('add','auth.ts');await f.git('commit','-qm','Method ranking fixture');
  const snapshot=await f.context.index(f.root);assert.equal(f.context.search(snapshot.id,'rotatePersonalToken',1)[0].name,'Store.rotatePersonalToken');
 }finally{await f.close();}
});
test('selected code publishes through real pool authorization and becomes remotely searchable',async()=>{
 const f=await fixture(),store=new TeamStore(':memory:');const owner=store.createUser('Owner'),outsider=store.createUser('Outsider');
 const pool=store.createPool(owner.user.id,'Code decisions','shared');
 // Use a reserved port so the configured origin matches the actual listener.
 const {createServer}=await import('node:net');const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const address=reservation.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}`;await new Promise<void>(r=>reservation.close(()=>r()));
 const app=createTeamServer(store,{ownerToken:'test-operator-'.repeat(4),publicUrl:url,provider:{identity:'test',embed:async texts=>texts.map(()=>[1,0])}});await new Promise<void>(r=>app.listen(address.port,'127.0.0.1',r));
 try{
  const snapshot=await f.context.index(f.root,pool.id),hit=f.context.search(snapshot.id,'authenticate')[0];
  await assert.rejects(publishCode(f.context,new TeamClient(url,outsider.token),snapshot.id,pool.id,[hit.id]));assert.equal(store.listMemories(owner.user.id,pool.id).length,0);
  const client=new TeamClient(url,owner.token);const receipt=await publishCode(f.context,client,snapshot.id,pool.id,[hit.id]);assert.equal(receipt.ids.length,1);assert.equal(store.listMemories(owner.user.id,pool.id).length,1);
  assert.equal((await client.search(pool.id,'authenticate'))[0].citations?.[0],hit.citation);
  const repeated=await publishCode(f.context,client,snapshot.id,pool.id,[hit.id]);assert.equal(repeated.imported,0);
  await assert.rejects(publishCode(f.context,client,snapshot.id,'other-pool',[hit.id]),/differs/);
 }finally{app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));store.close();await f.close();}
});
test('MCP local code retrieval works without a valid remote credential',async()=>{
 const f=await fixture();const server=remoteAgentServer(async()=>{throw Error('No remote credential');},f.home);const client=new Client({name:'code-test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();try{
  const snapshot=await f.context.index(f.root);await server.connect(a);await client.connect(b);
  const repositories=await client.callTool({name:'list_repositories',arguments:{}});assert.ok(!repositories.isError);assert.ok(JSON.stringify(repositories).includes(snapshot.revision));
  const result=await client.callTool({name:'search_code',arguments:{repositoryId:snapshot.id,query:'authenticate'}});assert.ok(!result.isError);assert.match(JSON.stringify(result),/pensieve-code:/);
  const remote=await client.callTool({name:'list_pools',arguments:{}});assert.equal(remote.isError,true);
 }finally{await client.close();await server.close();await f.close();}
});

test('local repository UI indexes and reviews cited code without uploading',async()=>{
 const f=await fixture(),store=new Store(':memory:');
 const app=createApp(store,{identity:'synthetic',embed:async texts=>texts.map(()=>[1,0])},{home:f.home});
 await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const address=app.server.address();assert.ok(address&&typeof address==='object');
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
  browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${address.port}/#${app.token}`);
  await expect(page.locator('#status')).toHaveText('Private memory pool ready.');
  await page.locator('#repository-path').fill(f.root);await page.getByRole('button',{name:'Index committed code'}).click();
  await expect(page.locator('#repository-status')).toContainText('Stored locally; nothing uploaded.');
  await page.locator('#repository-query').fill('authenticate');await page.getByRole('button',{name:'Search code',exact:true}).click();
  await expect(page.locator('#repository-results article')).toHaveCount(1);
  await expect(page.locator('#repository-results')).toContainText('pensieve-code://');
  await page.locator('#repository-results input[type=checkbox]').check();await page.locator('#repository-publish').click();
  await expect(page.locator('#status')).toHaveText('Choose a destination pool first');
  assert.equal(store.stats().memories,0);await page.screenshot({path:join(tmpdir(),'pensieve-repository-context.png'),fullPage:true});
 }finally{await browser?.close();app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));store.close();await f.close();}
});
