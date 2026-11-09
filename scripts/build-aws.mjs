#!/usr/bin/env node
import {build} from 'esbuild';
import {mkdtemp,cp,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]??join(tmpdir(),'pensieve-aws.zip'));
const staging=await mkdtemp(join(tmpdir(),'pensieve-lambda-'));
try{
 await build({absWorkingDir:root,entryPoints:['src/aws-handler.ts','src/aws-worker.ts'],outdir:join(staging,'dist'),bundle:true,platform:'node',target:'node24',format:'esm',external:['@huggingface/transformers','pg-native'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"},sourcemap:false,metafile:true}).then(async result=>{
  await writeFile(join(staging,'build-manifest.json'),JSON.stringify({target:'node24',entries:['dist/aws-handler.js','dist/aws-worker.js'],inputs:Object.keys(result.metafile.inputs)},null,2));
 });
 await writeFile(join(staging,'package.json'),JSON.stringify({type:'module'}));
 await cp(join(root,'web'),join(staging,'web'),{recursive:true});
 // zip updates existing archives; remove only this explicitly generated output to avoid stale entries.
 await rm(output,{force:true});
 await run('zip',['-q','-r',output,'.'],{cwd:staging});
 const info=await stat(output);if(info.size>50*1024*1024)throw Error('Lambda direct-upload ZIP exceeds 50 MiB; use S3 artifact upload');
 console.log(JSON.stringify({artifact:output,bytes:info.size,runtime:'nodejs24.x',architecture:'arm64'}));
}finally{await rm(staging,{recursive:true,force:true});}
