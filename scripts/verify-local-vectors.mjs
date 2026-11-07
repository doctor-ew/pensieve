// Optional real Ollama smoke; run after pnpm build. All content is synthetic.
import assert from 'node:assert/strict';
import {TeamStore} from '../dist/team-store.js';
import {providerFromEnv} from '../dist/embeddings.js';
import {makeMemory} from '../dist/sessions.js';
const store=new TeamStore(':memory:');
try {
 const user=store.createUser('Synthetic vector smoke').user;
 const a=store.createPool(user.id,'Synthetic engineering','private');
 const b=store.createPool(user.id,'Synthetic unrelated','private');
 const make=(text)=>makeMemory({text,source:'manual',session:'synthetic',role:'user',timestamp:'',locator:'synthetic-smoke',project:'/synthetic'});
 const expected=make('Synthetic decision: SQLite stores project memories locally so engineers can work offline without a network connection.');
 store.putMemories(user.id,a.id,[expected,make('Synthetic lunch preference: tomato soup and fresh bread.')]);
 const secret=make('Synthetic secret in another pool: SQLite offline memory architecture.');store.putMemory(user.id,b.id,secret);
 const provider=providerFromEnv();assert.equal(await store.index(user.id,a.id,provider),2);await store.index(user.id,b.id,provider);
 const hits=await store.search(user.id,a.id,'Why did engineers choose local storage for disconnected work?',provider,2);
 assert.equal(hits[0].id,expected.id);assert(!hits.some(x=>x.id===secret.id));
 console.log(JSON.stringify({status:'passed',provider:provider.identity,memories:2,topScore:hits[0].score,poolIsolation:true}));
}finally{store.close();}
