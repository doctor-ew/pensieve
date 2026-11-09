import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {ScanCommand,type ScanCommandOutput} from '@aws-sdk/lib-dynamodb';
import {AwsDatabase,type AwsItem} from './aws-db.js';
import {AwsShareStore} from './aws-share-store.js';
import type {Snapshot} from './executive.js';
import {validateMemoryRecord} from './memory-record.js';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const normalize=(v:unknown):unknown=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,normalize(x)])):v;
const canonical=(v:unknown)=>JSON.stringify(normalize(v));
type Row=Record<string,string|number|null>;
const allowed=['team_meta','team_users','team_access_identities','team_pools','team_members','team_memories','team_origins','team_vectors','team_shares','team_policies','shares','challenges','access','revisions','delivery_attempts','delivery_quota','verification_limits','connector_clients','connector_pending','connector_codes','connector_tokens'];
export interface AwsMigrationReceipt {fingerprint:string;files:Record<string,string>;counts:Record<string,number>;records:number;state:'ready'}
/** Offline maintenance import. Global visibility gate stays closed after any incomplete import. */
export async function migrateAws(home:string,db:AwsDatabase,shares:AwsShareStore,assertQuiescent:()=>Promise<void>):Promise<AwsMigrationReceipt>{
 await assertQuiescent();
 const tables=new Map<string,Row[]>(),files:Record<string,string>={};
 for(const name of ['team.sqlite','team-shares.sqlite','connector.sqlite']){
  const path=join(home,name);const info=await stat(path);if(info.size>200*1024*1024)throw Error('Source exceeds 200 MiB maintenance limit');
  if((await stat(path+'-wal').catch(()=>undefined))?.size)throw Error('Use frozen SQLite backup copies without WAL');
  files[name]=hash(await readFile(path));const source=new DatabaseSync(path,{readOnly:true});
  try{for(const row of source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()){
   const table=String(row.name);if(!allowed.includes(table)||tables.has(table))throw Error('Unsupported or duplicated source table: '+table);
   const count=Number(source.prepare(`SELECT count(*) AS n FROM "${table}"`).get()!.n);if(count>100000)throw Error('Source table exceeds maintenance row limit');
   tables.set(table,source.prepare(`SELECT * FROM "${table}"`).all() as Row[]);
  }}finally{source.close();}
 }
 const fingerprint=hash(canonical(files)),prior=await db.get('SYSTEM','MIGRATION');
 if(prior&&prior.fingerprint!==fingerprint)throw Error('Destination belongs to a different migration; do not overwrite live data');
 if(prior?.state==='ready')return prior.receipt as AwsMigrationReceipt;
 const started=Number(prior?.started??Date.now()),lease=randomUUID(),leaseUntil=Date.now()+3600000;
 if(prior?.state==='importing'&&Number(prior.leaseUntil)>Date.now())throw Error('Another importer holds the migration lease');
 const rows=(name:string)=>tables.get(name)??[];
 if(rows('revisions').length)throw Error('Legacy archived share revisions require a separate archive migration before cutover');
 const records:AwsItem[]=[],batchMarkers:AwsItem[]=[];
 const add=(pk:string,sk:string,body:Record<string,unknown>)=>records.push({pk,sk,...body});
 const issuer=rows('team_meta').find(row=>row.key==='issuer')?.value;if(typeof issuer!=='string')throw Error('Missing original source issuer');
 add('SYSTEM','ISSUER',{value:issuer});
 const users=new Map(rows('team_users').map(row=>[String(row.id),row]));
 for(const row of users.values()){
  const used=rows('team_members').some(member=>member.actor===row.id)||rows('team_memories').some(memory=>memory.contributor===row.id);
  add('USER#'+row.id,'META',{id:row.id,name:row.name,token:row.token,active:row.active===1,used,version:1});add('TOKEN#'+row.token,'META',{actor:row.id});
 }
 for(const row of rows('team_access_identities'))add('IDENTITY#'+hash(JSON.stringify([row.issuer,row.subject])),'META',{issuer:row.issuer,subject:row.subject,actor:row.actor});
 for(const row of rows('team_pools')){
  const owners=rows('team_members').filter(member=>member.pool===row.id&&member.role==='owner');if(owners.length!==1)throw Error('Pool must have one owner');
  add('POOL#'+row.id,'META',{id:row.id,name:row.name,visibility:row.visibility,owner:owners[0].actor,version:1});
  const batchId=hash(fingerprint+':'+row.id);batchMarkers.push({pk:'BATCH#'+batchId,sk:'META',kind:'index-batch',state:'committed',poolId:row.id,actor:owners[0].actor,created:0,indexState:'pending',indexVersion:0});
 }
 for(const row of rows('team_members')){if(!users.has(String(row.actor)))throw Error('Missing member identity');add('POOL#'+row.pool,'MEMBER#'+row.actor,{actor:row.actor,role:row.role,version:1});add('USER#'+row.actor,'POOL#'+row.pool,{poolId:row.pool});}
 for(const row of rows('team_memories')){
  const memory=JSON.parse(String(row.body));validateMemoryRecord(memory);const contributor=users.get(String(row.contributor));if(!contributor)throw Error('Missing memory contributor');
  const batchId=hash(fingerprint+':'+row.pool),revision=hash(canonical(memory));
  const origins=rows('team_origins').filter(origin=>origin.pool===row.pool&&origin.id===row.id).map(origin=>({...JSON.parse(String(origin.body)),verification:'unverified-import'}));
  add('POOL#'+row.pool,'MEMORY#'+row.id,{memory,revision,contributorId:row.contributor,contributorName:contributor.name,createdAt:row.created,batchId,origins,version:1});
  add('BATCH#'+batchId,'JOB#'+row.id,{kind:'index-job',poolId:row.pool,memoryId:row.id,revision,state:'pending'});
 }
 for(const row of rows('team_policies'))add('POOL#'+row.pool,`POLICY#${row.actor}#${row.scope}#${hash(String(row.context))}`,{policy:JSON.parse(String(row.body))});
 const mapping=new Map(rows('team_shares').map(row=>[String(row.id),row]));
 for(const row of rows('shares')){
  const map=mapping.get(String(row.id));if(!map)throw Error('Unmapped share cannot be published');
  const snapshot={...JSON.parse(String(row.body)),revoked:row.revoked===1} as Snapshot;
  const prepared=await shares.importSnapshot(snapshot);
  for(const action of prepared.actions){if(!action.Put?.Item)throw Error('Unsupported snapshot publication');const item=action.Put.Item as AwsItem;records.push(item.sk==='META'?{...item,poolId:map.pool,creatorId:map.creator}:item);}
  add('POOL#'+map.pool,'SHARE#'+map.id,{shareId:map.id,poolId:map.pool,creatorId:map.creator,ids:JSON.parse(String(map.ids))});
 }
 for(const row of rows('access'))add('SHARE#'+row.share,'GRANT#'+row.digest,{email:row.email,expiresAt:row.expires,ttl:Math.ceil(Number(row.expires)/1000)});
 for(const row of rows('challenges'))add('SHARE#'+row.share,'CHALLENGE#'+hash(String(row.email)),{email:row.email,digest:row.digest,expiresAt:row.expires,attempts:row.attempts,sent:row.sent,window:row.window,sends:row.sends,ttl:Math.ceil(Math.max(Number(row.expires),Number(row.window)+3600000)/1000)});
 for(const table of ['connector_clients','connector_pending','connector_codes','connector_tokens'])for(const row of rows(table)){
  const expiresAt=table==='connector_clients'?Math.max(started+86400000,...['connector_pending','connector_codes','connector_tokens'].flatMap(name=>rows(name).filter(grant=>JSON.parse(String(grant.body)).clientId===row.id).map(grant=>Number(grant.expires)))):Number(row.expires);
  add('CONNECTOR#'+table,String(row.id??row.digest),{body:row.body,expiresAt,ttl:Math.ceil(expiresAt/1000)});
 }
 for(const row of rows('delivery_attempts'))add('DELIVERY#'+row.share,hash(String(row.email)),{kind:'delivery-job',state:['queued','sending'].includes(String(row.status))?'unknown':row.status,actor:row.actor,share:row.share,email:row.email,created:row.created});
 const quotas=new Map<string,number[]>();for(const row of rows('delivery_quota')){const key=String(row.scope);quotas.set(key,[...(quotas.get(key)??[]),Number(row.created)]);}
 for(const [scope,times] of quotas)add('MAIL-QUOTA#'+hash(scope),'META',{times,version:1,ttl:Math.ceil((Math.max(...times)+3600000)/1000)});
 // Legacy vector arrays and obsolete verification-window data remain in checksum-verified backups.
 for(const marker of batchMarkers)add('WORK#INDEX','PENDING#'+marker.pk.slice('BATCH#'.length),{batchId:marker.pk.slice('BATCH#'.length)});
 const all=[...records,...batchMarkers];for(const row of all)if(Buffer.byteLength(JSON.stringify(row))>300000)throw Error('Imported record exceeds hosted record limit');
 if(!prior){
  let key:ScanCommandOutput['LastEvaluatedKey'];do{const page:ScanCommandOutput=await db.client.send(new ScanCommand({TableName:db.table,ConsistentRead:true,Limit:100,ExclusiveStartKey:key,ProjectionExpression:'pk,sk'}));if(page.Items?.some(item=>!(item.pk==='SYSTEM'&&item.sk==='ISSUER')))throw Error('Destination is not empty; refusing live data overwrite');key=page.LastEvaluatedKey;}while(key);
  await db.put({pk:'SYSTEM',sk:'MIGRATION',fingerprint,state:'importing',started,lease,leaseUntil},'attribute_not_exists(pk)');
 }else{await db.put({...prior,lease,leaseUntil},'leaseUntil <= :now',{':now':Date.now()});}
 let inserted=0;
 for(const row of all){
  const existing=await db.get(row.pk,row.sk);
  if(existing){if(canonical(existing)===canonical(row))continue;if(row.pk==='SYSTEM'&&row.sk==='ISSUER'&&inserted===0){await db.transact([db.check('SYSTEM','MIGRATION','lease = :lease',{':lease':lease}),db.putAction(row)]);inserted++;continue;}throw Error('Migration record conflict: '+row.pk+'/'+row.sk);}
  await db.transact([db.check('SYSTEM','MIGRATION','lease = :lease',{':lease':lease}),db.putAction(row,'attribute_not_exists(pk)')]);inserted++;
 }
 for(const [name,digest] of Object.entries(files))if(hash(await readFile(join(home,name)))!==digest)throw Error('Source backup changed during import');
 const receipt:AwsMigrationReceipt={fingerprint,files,counts:Object.fromEntries([...tables].map(([name,data])=>[name,data.length])),records:all.length,state:'ready'};
 await db.put({pk:'SYSTEM',sk:'MIGRATION',fingerprint,state:'ready',receipt},'fingerprint = :fingerprint AND lease = :lease',{':fingerprint':fingerprint,':lease':lease});return receipt;
}
