import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import type {AwsDatabase} from './aws-db.js';
import {conditionalFailure} from './aws-db.js';
export interface VersionedRecord<T=unknown>{revision:number;value:T}
export interface RepositoryRecordWrite {key:string;partition:string;expected:number|undefined;value:unknown}
export interface RepositoryRecords {
 compareAndSetMany(writes:RepositoryRecordWrite[]):Promise<boolean>;
 get<T>(key:string):Promise<VersionedRecord<T>|undefined>;
 list<T>(partition:string,after?:string):Promise<{items:Array<{key:string}&VersionedRecord<T>>;cursor?:string}>;
 compareAndSet<T>(key:string,partition:string,expected:number|undefined,value:T):Promise<boolean>;
}
/** Compare-and-set is the publication and job-lease boundary for every backend. */
export class LocalRepositoryRecords implements RepositoryRecords {
 private db:DatabaseSync;
 constructor(path:string){mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);chmodSync(path,0o600);this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS repository_records(key TEXT PRIMARY KEY,partition TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS repository_record_partition ON repository_records(partition,key)');}
 close(){this.db.close();}
 async get<T>(key:string){const row=this.db.prepare('SELECT revision,body FROM repository_records WHERE key=?').get(key);return row?{revision:Number(row.revision),value:JSON.parse(String(row.body)) as T}:undefined;}
 async list<T>(partition:string,after=''){const rows=this.db.prepare('SELECT key,revision,body FROM repository_records WHERE partition=? AND key>? ORDER BY key LIMIT 51').all(partition,after);const page=rows.slice(0,50);return {items:page.map(r=>({key:String(r.key),revision:Number(r.revision),value:JSON.parse(String(r.body)) as T})),...(rows.length>50?{cursor:String(page.at(-1)!.key)}:{})};}
 async compareAndSet<T>(key:string,partition:string,expected:number|undefined,value:T){return this.compareAndSetMany([{key,partition,expected,value}]);}
 async compareAndSetMany(writes:RepositoryRecordWrite[]){
  if(!writes.length||writes.length>10||new Set(writes.map(w=>w.key)).size!==writes.length)throw Error('Invalid repository transaction');
  this.db.exec('BEGIN IMMEDIATE');try{
   for(const {key,partition,expected,value} of writes){const body=JSON.stringify(value);if(Buffer.byteLength(body)>300000)throw Error('Repository record too large');
    const result=expected===undefined?this.db.prepare('INSERT OR IGNORE INTO repository_records VALUES (?,?,1,?)').run(key,partition,body):this.db.prepare('UPDATE repository_records SET body=?,revision=revision+1 WHERE key=? AND partition=? AND revision=?').run(body,key,partition,expected);
    if(result.changes!==1){this.db.exec('ROLLBACK');return false;}
   }this.db.exec('COMMIT');return true;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
export class AwsRepositoryRecords implements RepositoryRecords {
 constructor(private db:AwsDatabase){}
 async get<T>(key:string){const row=await this.db.get('CODE-RECORD#'+key,'RECORD');return row?{revision:Number(row.revision),value:JSON.parse(String(row.body)) as T}:undefined;}
 async list<T>(partition:string,after?:string){const page=await this.db.query('CODE-LIST#'+partition,{after,limit:50});return {items:page.items.map(r=>({key:r.sk,revision:Number(r.revision),value:JSON.parse(String(r.body)) as T})),...(page.cursor?{cursor:page.cursor}:{})};}
 async compareAndSet<T>(key:string,partition:string,expected:number|undefined,value:T){return this.compareAndSetMany([{key,partition,expected,value}]);}
 async compareAndSetMany(writes:RepositoryRecordWrite[]){
  if(!writes.length||writes.length>10||new Set(writes.map(w=>w.key)).size!==writes.length)throw Error('Invalid repository transaction');
  const actions=writes.flatMap(({key,partition,expected,value})=>{
   const body=JSON.stringify(value);if(Buffer.byteLength(body)>300000)throw Error('Repository record too large');const revision=(expected??0)+1;
   const record={pk:'CODE-RECORD#'+key,sk:'RECORD',revision,partition,body};
   return [{Put:{TableName:this.db.table,Item:record,ConditionExpression:expected===undefined?'attribute_not_exists(pk)':'#revision = :expected AND #partition = :partition',...(expected===undefined?{}:{ExpressionAttributeNames:{'#revision':'revision','#partition':'partition'},ExpressionAttributeValues:{':expected':expected,':partition':partition}})}},this.db.putAction({...record,pk:'CODE-LIST#'+partition,sk:key})];
  });
  try{await this.db.transact(actions);return true;}catch(error){if(conditionalFailure(error))return false;throw error;}
 }
}
