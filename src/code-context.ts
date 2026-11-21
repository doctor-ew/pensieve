import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdirSync,chmodSync,realpathSync} from 'node:fs';
import {join,basename} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {generateNodeId} from './vendor/mex-node-id.js';
import type {Memory} from './types.js';
import type {TeamClient} from './team-client.js';

const run=promisify(execFile);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const git=async(root:string,args:string[],maxBuffer=4_000_000)=>(await run('git',['--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd:root,encoding:'utf8',maxBuffer,timeout:30000,env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1'}})).stdout;
export interface CodeSymbol {id:string;file:string;name:string;kind:string;startLine:number;endLine:number;bodyHash:string;snippet:string;truncated:boolean}
export interface RepositorySnapshot {id:string;name:string;root:string;revision:string;indexedAt:string;pool?:string;files:number;symbols:number;skipped:number}

/** Parse source only: never load project config, dependencies, plugins, or execute code. */
export function extractCode(file:string,source:string):CodeSymbol[] {
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  const symbols:CodeSymbol[]=[];const occurrences=new Map<string,number>();
  function walk(node:ts.Node,scope:string[]){
    let kind:string|undefined;
    if(ts.isFunctionDeclaration(node))kind='function';
    else if(ts.isClassDeclaration(node))kind='class';
    else if(ts.isInterfaceDeclaration(node))kind='interface';
    else if(ts.isTypeAliasDeclaration(node))kind='type_alias';
    else if(ts.isEnumDeclaration(node))kind='enum';
    else if(ts.isMethodDeclaration(node)||ts.isGetAccessor(node)||ts.isSetAccessor(node))kind='method';
    else if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))kind='variable';
    const named=node as ts.NamedDeclaration;
    const name=kind?(named.name?.getText(ast)??'default'):undefined;
    let childScope=scope;
    if(kind&&name){
      const qualified=[...scope,name].join('.');
      const base=generateNodeId(file,kind,name,qualified);
      const occurrence=occurrences.get(base)??0;occurrences.set(base,occurrence+1);
      const start=node.getStart(ast),end=node.end,body=source.slice(start,end);
      symbols.push({id:occurrence?generateNodeId(file,kind,name,qualified,`${kind}:${occurrence}`):base,file,name:qualified,kind,startLine:ast.getLineAndCharacterOfPosition(start).line+1,endLine:ast.getLineAndCharacterOfPosition(end).line+1,bodyHash:hash(body),snippet:body.slice(0,6000),truncated:body.length>6000});
      childScope=[...scope,name];
    }
    ts.forEachChild(node,child=>walk(child,childScope));
  }
  walk(ast,[]);
  return symbols;
}

export class CodeContext {
  private db:DatabaseSync;
  constructor(home:string){
    mkdirSync(home,{recursive:true,mode:0o700});const path=join(home,'code-context.sqlite');
    this.db=new DatabaseSync(path);chmodSync(path,0o600);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS repositories(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS code_symbols(repo TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(repo,id));
      CREATE VIRTUAL TABLE IF NOT EXISTS code_search USING fts5(repo UNINDEXED,id UNINDEXED,name,file,snippet);`);
  }
  close(){this.db.close();}
  list():RepositorySnapshot[]{return this.db.prepare('SELECT body FROM repositories ORDER BY id').all().map(r=>JSON.parse(String(r.body)));}
  get(id:string):RepositorySnapshot{const row=this.db.prepare('SELECT body FROM repositories WHERE id=?').get(id);if(!row)throw Error('Repository is not indexed in this local home');return JSON.parse(String(row.body));}
  async status(id:string){const snapshot=this.get(id);try{const revision=(await git(snapshot.root,['rev-parse','--verify','HEAD'])).trim();const dirty=!!(await git(snapshot.root,['status','--porcelain','--untracked-files=no'])).trim();return {...snapshot,currentRevision:revision,stale:revision!==snapshot.revision,uncommittedChanges:dirty};}catch{return {...snapshot,currentRevision:null,stale:true,unavailable:true};}}
  async index(path:string,pool?:string){
    if(pool!==undefined&&!/^[a-zA-Z0-9_-]{1,128}$/.test(pool))throw Error('Invalid pool ID');
    const root=realpathSync((await git(realpathSync(path),['rev-parse','--show-toplevel'])).trim());
    const revision=(await git(root,['rev-parse','--verify','HEAD^{commit}'])).trim();
    if(!/^[a-f0-9]{40,64}$/.test(revision))throw Error('Repository requires a committed revision');
    const entries=(await git(root,['ls-tree','-r','-z','--full-tree',revision])).split('\0').filter(Boolean);
    const symbols:CodeSymbol[]=[];let files=0,skipped=0,bytes=0;
    for(const entry of entries){
      const match=/^(\d+) blob ([a-f0-9]+)\t(.+)$/s.exec(entry);if(!match){skipped++;continue;}
      const [,mode,oid,file]=match;
      if(!/^100(?:644|755)$/.test(mode)||! /\.(?:[cm]?[jt]sx?)$/i.test(file)||file.split('/').some(p=>p.startsWith('.')||['node_modules','dist','build','vendor','coverage'].includes(p))||/\.d\.[cm]?ts$/i.test(file)){skipped++;continue;}
      if(++files>2000)throw Error('Repository exceeds the 2,000 source-file limit');
      const size=Number((await git(root,['cat-file','-s',oid])).trim());
      if(size>500_000){skipped++;files--;continue;}
      bytes+=size;if(bytes>20_000_000)throw Error('Repository exceeds the 20 MB source limit');
      const source=await git(root,['cat-file','blob',oid],600_000);
      if(source.includes('\0')){skipped++;files--;continue;}
      symbols.push(...extractCode(file,source));if(symbols.length>20000)throw Error('Repository exceeds the 20,000 symbol limit');
    }
    const id=hash(root).slice(0,32),previous=this.list().find(r=>r.id===id);
    const snapshot:RepositorySnapshot={id,name:basename(root),root,revision,indexedAt:new Date().toISOString(),...(pool??previous?.pool?{pool:pool??previous?.pool}:{}),files,symbols:symbols.length,skipped};
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('DELETE FROM code_symbols WHERE repo=?').run(id);this.db.prepare('DELETE FROM code_search WHERE repo=?').run(id);
      const insert=this.db.prepare('INSERT INTO code_symbols VALUES (?,?,?)'),search=this.db.prepare('INSERT INTO code_search VALUES (?,?,?,?,?)');
      for(const s of symbols){insert.run(id,s.id,JSON.stringify(s));search.run(id,s.id,s.name,s.file,s.snippet);}
      this.db.prepare('INSERT OR REPLACE INTO repositories VALUES (?,?)').run(id,JSON.stringify(snapshot));this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return snapshot;
  }
  search(repo:string,query:string,limit=8){
    const snapshot=this.get(repo);if(!Number.isInteger(limit)||limit<1||limit>50)throw Error('Limit must be between 1 and 50');
    if(typeof query!=='string'||query.length>1000)throw Error('Query must be at most 1,000 characters');
    const words=query.match(/[\p{L}\p{N}_]+/gu)?.slice(0,12);if(!words?.length)throw Error('Enter a symbol, path, or code term');
    const exact=query.trim().toLowerCase();
    const rows=this.db.prepare(`SELECT id FROM code_search WHERE code_search MATCH ? AND repo=?
      ORDER BY CASE WHEN lower(name)=? OR substr(lower(name),-(length(?)+1))='.'||? THEN 0 ELSE 1 END,
      bm25(code_search,0,0,8,4,1) LIMIT ?`).all(words.map(w=>'"'+w+'"').join(' OR '),repo,exact,exact,exact,limit);
    return rows.map(r=>{const symbol=this.symbol(repo,String(r.id));return {...symbol,repositoryId:repo,revision:snapshot.revision,citation:this.citation(snapshot,symbol)};});
  }
  private symbol(repo:string,id:string):CodeSymbol{const row=this.db.prepare('SELECT body FROM code_symbols WHERE repo=? AND id=?').get(repo,id);if(!row)throw Error('Selected symbol is not in this repository snapshot');return JSON.parse(String(row.body));}
  private citation(repo:RepositorySnapshot,s:CodeSymbol){return `pensieve-code://${repo.id}/${encodeURIComponent(s.file)}?rev=${repo.revision}&symbol=${encodeURIComponent(s.id)}#L${s.startLine}-L${s.endLine}`;}
  memories(repo:string,ids:string[]):Memory[]{
    const snapshot=this.get(repo);
    if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'))throw Error('Explicitly select 1–100 code symbols');
    return [...new Set(ids)].map(id=>{
      const s=this.symbol(repo,id),citation=this.citation(snapshot,s);
      return {id:hash(JSON.stringify([repo,snapshot.revision,s.id,s.bodyHash])),source:'manual',role:'user',kind:'raw',session:`repository:${repo}@${snapshot.revision}`,project:`repository:${repo}`,timestamp:'',locator:`${s.file}:L${s.startLine}-L${s.endLine}`,citations:[citation],text:`Code snapshot: ${snapshot.name}\nRevision: ${snapshot.revision}\nSymbol: ${s.name} (${s.kind})\nFile: ${s.file}:${s.startLine}-${s.endLine}\nBody SHA-256: ${s.bodyHash}\n${s.truncated?'Excerpt truncated.\n':''}\n${s.snippet}`};
    });
  }
}

/** Only explicit selections leave this machine; existing server policy remains authoritative. */
export async function publishCode(context:CodeContext,client:TeamClient,repo:string,pool:string,ids:string[]){
  const snapshot=context.get(repo);if(snapshot.pool&&snapshot.pool!==pool)throw Error('Selected pool differs from the repository attachment; reattach explicitly first');
  const memories=context.memories(repo,ids),repository=`repository:${repo}`;
  const policy=await client.policy(pool,{repository});
  if(policy.effective.destination==='off'||(policy.effective.destination==='shared'&&policy.effective.pool!==pool))throw Error('Pool capture policy does not permit this publication');
  let imported=0;
  for(let start=0;start<memories.length;start+=16){const result=await client.putMemories(pool,memories.slice(start,start+16),undefined,{repository});imported+=result.imported;}
  // Index failures must not misrepresent already-published data as unsent.
  let indexing:unknown;try{indexing=await client.index(pool);}catch{indexing={pending:true,error:'Published successfully; run team-index to retry indexing'};}
  return {published:true,server:client.url,pool,repositoryId:repo,revision:snapshot.revision,imported,ids:memories.map(m=>m.id),indexing};
}
