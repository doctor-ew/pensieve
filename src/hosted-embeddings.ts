import type {EmbeddingProvider} from './types.js';
import {validateVector} from './embeddings.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
const model='Xenova/all-MiniLM-L6-v2';
const revision='751bff37182d3f1213fa05d7196b954e230abad9';
export const hostedModelIdentity=`transformers:${model}@${revision}:q8:mean-v1`;
// Download only public model assets. Memory text stays in this server process.
export function hostedEmbeddings(cacheDir=join(homedir(),'.cache','pensieve-models')):EmbeddingProvider {
  let extractor:Promise<import('@huggingface/transformers').FeatureExtractionPipeline>|undefined;
  let queue:Promise<unknown>=Promise.resolve();
  const load=()=>extractor??=(async()=>{
    const {pipeline}=await import('@huggingface/transformers');
    return pipeline('feature-extraction',model,{revision,dtype:'q8',device:'cpu',cache_dir:cacheDir,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  })().catch(error=>{extractor=undefined;throw error;});
  return {identity:hostedModelIdentity,embed(texts){
    if(!Array.isArray(texts)||texts.length>256||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>10000))return Promise.reject(Error('Invalid embedding input'));
    const task=queue.then(async()=>{
      if(!texts.length)return [];
      const pipe=await load();const result:number[][]=[];
      for(let offset=0;offset<texts.length;offset+=8){
        const tensor=await pipe(texts.slice(offset,offset+8),{pooling:'mean',normalize:true});
        const vectors=tensor.tolist() as number[][];
        if(vectors.length!==Math.min(8,texts.length-offset))throw Error('Embedding response count mismatch');
        for(const vector of vectors){validateVector(vector);if(vector.length!==384)throw Error('Embedding dimension mismatch');result.push(vector);}
      }
      return result;
    });queue=task.catch(()=>{});return task;
  }};
}
