import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TeamClient, ContributionQueue} from '../src/team-client.js';
import {makeMemory} from '../src/sessions.js';
const memory = makeMemory({text:'Synthetic: agreed to test one workflow.',source:'manual',role:'user',timestamp:'',locator:'fixture',session:'test',project:'/synthetic'});
test('team transport rejects insecure remote URLs and does not follow redirects', async t => {
  assert.throws(() => new TeamClient('http://example.com','secret'), /HTTPS/);
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(init.redirect, 'error'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer secret');
    return new Response(JSON.stringify({pools:[]}),{status:200});
  });
  assert.deepEqual(await new TeamClient('https://example.com','secret').pools(), []);
});
test('private and disabled capture never enqueue or publish; failed shared contributions retry durably', async () => {
  const home=await mkdtemp(join(tmpdir(),'pensieve-queue-'));
  let calls=0, fail=true;
  const send=async (_pool:string, memories:typeof memory[])=>{calls++;assert.equal(memories.length,1);if(fail)throw Error('offline');return {imported:1};};
  let queue=new ContributionQueue(home);
  assert.equal(queue.enqueue(memory,{destination:'private'}),false);
  assert.equal(queue.enqueue(memory,{destination:'off'}),false);
  assert.equal(queue.enqueue(memory,{destination:'shared',pool:'team-a'}),true);
  assert.equal(queue.enqueue(memory,{destination:'shared',pool:'team-a'}),false);
  let result=await queue.flush(send,async(pool)=>({destination:'shared',pool}));assert.equal(result.pending,1);assert.equal(result.sent,0);queue.close();
  queue=new ContributionQueue(home);fail=false;result=await queue.flush(send,async(pool)=>({destination:'shared',pool}));assert.equal(result.sent,1);assert.equal(result.pending,0);assert.equal(calls,2);
  queue.close();
});
test('queued memories never cross accounts or retarget after policy changes', async () => {
  const home=await mkdtemp(join(tmpdir(),'pensieve-policy-queue-'));
  let queue=new ContributionQueue(home,'account-A');queue.enqueue(memory,{destination:'shared',pool:'original'},{repository:'/synthetic',conversation:'session-1'});queue.close();
  queue=new ContributionQueue(home,'account-B');let calls=0;
  const send=async()=>{calls++;};
  assert.equal((await queue.flush(send,async(pool)=>({destination:'shared',pool}))).sent,0);queue.close();
  queue=new ContributionQueue(home,'account-A');
  for(const policy of [{destination:'off'},{destination:'private'},{destination:'shared',pool:'different'}] as const){
    const result=await queue.flush(send,async(_pool,context)=>{assert.equal(context.conversation,'session-1');return policy;});
    assert.equal(result.sent,0);assert.equal(result.pending,1);
  }
  assert.equal(calls,0);
  assert.equal((await queue.flush(send,async()=>({destination:'shared',pool:'original'}))).sent,1);assert.equal(calls,1);queue.close();
});
