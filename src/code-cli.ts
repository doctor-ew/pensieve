import {join} from 'node:path';
import {homedir} from 'node:os';
import {CodeContext,publishCode} from './code-context.js';
import {connectedClient} from './team-cli.js';
export async function runCodeCommand(command:string,arg:string|undefined,options:{home?:string;repo?:string;pool?:string;ids?:string;limit?:string}){
  const home=options.home??join(homedir(),'.pensieve'),context=new CodeContext(home);
  const need=(value:string|undefined,label:string)=>{if(!value)throw Error(`${label} required`);return value;};
  try{
    let result:unknown;
    if(command==='repo-index')result=await context.index(need(arg,'Repository path'),options.pool);
    else if(command==='repo-list')result=await Promise.all(context.list().map(r=>context.status(r.id)));
    else if(command==='repo-search')result={repository:await context.status(need(options.repo,'--repo')),hits:context.search(options.repo!,need(arg,'Query'),Number(options.limit??8))};
    else if(command==='repo-publish')result=await publishCode(context,await connectedClient(home),need(arg,'Repository ID'),need(options.pool,'--pool'),need(options.ids,'--ids').split(','));
    else throw Error('Unknown repository command');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }finally{context.close();}
}
