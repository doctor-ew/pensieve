import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {mkdir,readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname,relative,sep} from 'node:path';
import {GetObjectCommand,PutObjectCommand,type S3Client} from '@aws-sdk/client-s3';
export interface RepositoryBlobs {put(key:string,bytes:Uint8Array):Promise<void>;get(key:string):Promise<Uint8Array>}
export function safeRepositoryPath(value:string){if(!value||value.length>1024||value.includes('\\')||value.includes(':')||value.includes('\0')||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid repository path');return value;}
export interface SourceFile {path:string;content:string;sha256:string}
export interface RepositoryCoverage {tracked:number;semantic:number;citedText:number;skipped:Array<{path:string;reason:'non-file'|'excluded-directory'|'unsupported-extension'}>}
export interface SourceSnapshot {version:1;revision:string;files:SourceFile[];coverage?:RepositoryCoverage}
export const semanticSource=(path:string)=>/\.(?:[cm]?[jt]sx?|py|rs|cs)$/i.test(path);
export const citedTextSource=(path:string)=>/\.(?:md|mdx|swift)$/i.test(path);
export function validateSnapshot(value:unknown):SourceSnapshot {
 const input=value as SourceSnapshot;if(input?.version!==1||typeof input.revision!=='string'||!/^[a-f0-9]{40,64}$/.test(input.revision)||!Array.isArray(input.files)||input.files.length>5000)throw Error('Invalid source snapshot');
 const names=new Set<string>();let bytes=0;
 for(const file of input.files){safeRepositoryPath(file.path);if(file.path.split('/').some(p=>p==='.git'||p==='.mex'||p==='node_modules'||p==='.env'||p.startsWith('.env.')||p==='id_rsa'||p==='id_ed25519'))throw Error('Excluded repository file');if(names.has(file.path))throw Error('Duplicate repository path');names.add(file.path);if(typeof file.content!=='string'||!file.content.match(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))throw Error('Invalid source encoding');const data=Buffer.from(file.content,'base64');bytes+=data.length;if(data.length>1000000||bytes>25000000||createHash('sha256').update(data).digest('hex')!==file.sha256)throw Error('Invalid source size or digest');}
 return input;
}
export class LocalRepositoryBlobs implements RepositoryBlobs {
 constructor(private root:string){}
 private path(key:string){return join(this.root,safeRepositoryPath(key));}
 async put(key:string,bytes:Uint8Array){const path=this.path(key);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,bytes,{flag:'wx',mode:0o600});}
 async get(key:string){return readFile(this.path(key));}
}
export class S3RepositoryBlobs implements RepositoryBlobs {
 constructor(private s3:S3Client,private bucket:string){}
 async put(key:string,bytes:Uint8Array){safeRepositoryPath(key);await this.s3.send(new PutObjectCommand({Bucket:this.bucket,Key:'repositories/'+key,Body:bytes,ContentType:'application/octet-stream',IfNoneMatch:'*'}));}
 async get(key:string){safeRepositoryPath(key);const response=await this.s3.send(new GetObjectCommand({Bucket:this.bucket,Key:'repositories/'+key}));if((response.ContentLength??0)>128000000||!response.Body)throw Error('Repository artifact exceeds limit');const chunks:Uint8Array[]=[];let bytes=0;for await(const part of response.Body as AsyncIterable<Uint8Array>){bytes+=part.length;if(bytes>128000000)throw Error('Repository artifact exceeds limit');chunks.push(part);}return Buffer.concat(chunks);}
}
export async function unpackSources(root:string,snapshot:SourceSnapshot){validateSnapshot(snapshot);await mkdir(root,{recursive:true,mode:0o700});for(const file of snapshot.files){const path=join(root,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,Buffer.from(file.content,'base64'),{flag:'wx',mode:0o600});}}
/** Internal workspace archives are produced only by the trusted worker, never accepted from upload requests. */
export async function packWorkspace(root:string):Promise<Uint8Array>{
 const canonical=await realpath(root),files:Array<{path:string;content:string}>=[];let size=0;
 const visit=async(dir:string):Promise<void>=>{for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Workspace symlink rejected');if(entry.isDirectory())await visit(path);else if(entry.isFile()){const info=await lstat(path);size+=info.size;if(size>128000000||files.length>=15000)throw Error('Workspace exceeds artifact limits');const bytes=await readFile(path);files.push({path:relative(canonical,path).split(sep).join('/'),content:bytes.toString('base64')});}}};await visit(canonical);return gzipSync(JSON.stringify({version:1,files}));
}
export async function unpackWorkspace(root:string,bytes:Uint8Array){
 const archive=JSON.parse(gunzipSync(bytes,{maxOutputLength:180000000}).toString('utf8')) as {version:number;files:Array<{path:string;content:string}>};if(archive.version!==1||!Array.isArray(archive.files)||archive.files.length>15000)throw Error('Invalid workspace archive');
 let size=0;const paths=new Set<string>();await mkdir(root,{recursive:true,mode:0o700});
 for(const file of archive.files){safeRepositoryPath(file.path);if(paths.has(file.path)||typeof file.content!=='string')throw Error('Invalid workspace file');paths.add(file.path);const data=Buffer.from(file.content,'base64');size+=data.length;if(size>128000000)throw Error('Workspace exceeds artifact limits');const path=resolve(root,file.path);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,data,{flag:'wx',mode:0o600});}
}
