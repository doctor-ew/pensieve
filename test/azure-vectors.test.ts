import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AzureVectorBackend } from '../src/azure-vectors.js';
import { TeamStore } from '../src/team-store.js';
import { makeMemory } from '../src/sessions.js';

const options = {endpoint:'https://synthetic.search.windows.net',index:'memories',key:'synthetic-key',model:'synthetic:model',dimensions:2};
test('Azure configuration rejects unsafe destinations and invalid dimensions before network', () => {
  for (const endpoint of ['http://synthetic.search.windows.net','https://evil.test','https://synthetic.search.windows.net.evil.test','https://user:pass@synthetic.search.windows.net','https://synthetic.search.windows.net/path','https://synthetic.search.windows.net?x=1']) assert.throws(()=>new AzureVectorBackend({...options,endpoint}));
  for (const dimensions of [0,-1,1.5,NaN]) assert.throws(()=>new AzureVectorBackend({...options,dimensions}));
});

test('Azure TeamStore contract retries partial item failure and excludes foreign IDs with trusted filters', async () => {
  let fail=true; const requests:{url:string;body:Record<string,unknown>}[]=[]; let foreign=''; let selected=''; const keys:string[]=[];
  const fakeFetch: typeof fetch = async (input,init) => {
    const url=String(input), body=JSON.parse(String(init?.body)); requests.push({url,body});
    assert.equal(new Headers(init?.headers).get('api-key'),'synthetic-key'); assert.equal(init?.redirect,'error'); assert.ok(init?.signal);
    if(url.includes('/docs/index')) {
      keys.push(body.value[0].id);
      return Response.json({value:body.value.map((r:{id:string})=>({key:r.id,status:!fail,statusCode:fail?503:201}))},{status:fail?207:200});
    }
    return Response.json({value:[{memoryId:foreign,'@search.score':1},{memoryId:selected,'@search.score':0.9}]});
  };
  const backend=new AzureVectorBackend({...options,fetch:fakeFetch}); const store=new TeamStore(':memory:',backend);
  try {
    const {user}=store.createUser('Alice'); const a=store.createPool(user.id,'A','private'), b=store.createPool(user.id,'B','private');
    const make=(text:string)=>makeMemory({text,source:'manual',role:'user',project:'synthetic',session:'synthetic',timestamp:'',locator:'synthetic'});
    const one=make('one'),two=make('two'); selected=one.id;foreign=two.id;store.putMemory(user.id,a.id,one);store.putMemory(user.id,b.id,two);
    const provider={identity:options.model,embed:async (texts:string[])=>texts.map(()=>[1,0])};
    await assert.rejects(store.index(user.id,a.id,provider),/index|upsert/i); fail=false;
    assert.equal(await store.index(user.id,a.id,provider),1); assert.equal(keys[0],keys[1]);
    assert.deepEqual((await store.search(user.id,a.id,'one',provider)).map(h=>h.id),[one.id]);
    const query=requests.at(-1)!.body; assert.equal(query.filter,`poolId eq '${a.id}' and model eq 'synthetic:model'`); assert.equal(query.vectorFilterMode,'preFilter');
    const indexed = (requests[0].body.value as Record<string,unknown>[])[0];
    assert.deepEqual(Object.keys(indexed).sort(), ['@search.action','id','memoryId','model','poolId','vector'].sort());
    assert.equal(indexed.text,undefined);
    await assert.rejects(backend.query(a.id,'wrong-model',[1,0],1),/model/i);
    await assert.rejects(backend.query(a.id,options.model,[1,0,0],1),/dimension/i);
  } finally {store.close();}
});

test('Azure escapes OData model quotes and refuses redirects and failed HTTP responses', async () => {
  let filter='';
  const backend=new AzureVectorBackend({...options,model:"m' or true",fetch:async(_url,init)=>{filter=JSON.parse(String(init?.body)).filter;return Response.json({value:[]});}});
  await backend.query("pool'quoted","m' or true",[1,0],1);
  assert.equal(filter,"poolId eq 'pool''quoted' and model eq 'm'' or true'");
  for(const status of [302,401,500]) {
    const broken=new AzureVectorBackend({...options,fetch:async()=>new Response('secret upstream details',{status})});
    await assert.rejects(broken.query('pool',options.model,[1,0],1),error=>error instanceof Error && !error.message.includes('secret'));
  }
});
