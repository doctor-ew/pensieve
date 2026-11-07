import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedEmbeddings,hostedModelIdentity} from '../src/hosted-embeddings.js';
test('hosted embeddings reject invalid batches without downloading a model',async()=>{
 const provider=hostedEmbeddings('/unused');
 assert.equal(provider.identity,hostedModelIdentity);
 assert.deepEqual(await provider.embed([]),[]);
 for(const input of [[''],['  '],['x'.repeat(10001)],Array(257).fill('text')])
   await assert.rejects(provider.embed(input),/Invalid embedding input/);
 assert.deepEqual(await provider.embed([]),[]);
});
