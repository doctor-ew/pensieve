import type {TeamMemory,TeamUser,TeamPool,TeamMember,TeamShare} from './team-store.js';
import type {ShareInput,Snapshot,Mailer} from './executive.js';
import type {DeliveryStatus,InvitationMessage,SecureMailer} from './delivery.js';
import type {Memory,MemoryProvenance,Bundle,EmbeddingProvider,Hit} from './types.js';
import type {PolicyLayers} from './policy.js';
export type Awaitable<T> = T | Promise<T>;
export interface MemoryPage {memories:TeamMemory[];nextCursor?:string}
export interface ShareSummary {id:string;title:string;recipients:string[];expiresAt:number;revoked:boolean;count:number}
export interface SharePage {shares:ShareSummary[];nextCursor?:string}
export interface TeamRepository {
 readonly sourceServer:string;
 readonly indexingMode?:'queued';
 close():Awaitable<void>;
 createUser(name:string):Awaitable<{user:TeamUser;token:string}>;
 accessUser(issuer:string,subject:string,email:string):Awaitable<TeamUser>;
 getUser(id:string):Awaitable<TeamUser>;
 authenticate(token:string):Awaitable<TeamUser>;
 revokeUser(id:string):Awaitable<void>;
 createPool(actor:string,name:string,visibility:TeamPool['visibility']):Awaitable<TeamPool>;
 listPools(actor:string):Awaitable<TeamPool[]>;
 getPool(actor:string,pool:string):Awaitable<TeamPool>;
 grantMember(actor:string,pool:string,userId:string,role:'reader'|'writer'):Awaitable<void>;
 listMembers(actor:string,pool:string):Awaitable<TeamMember[]>;
 putMemory(actor:string,pool:string,memory:Memory):Awaitable<{id:string;created:boolean}>;
 putMemories(actor:string,pool:string,memories:Memory[],provenance?:MemoryProvenance[]):Awaitable<{imported:number;ids:string[]}>;
 listMemories(actor:string,pool:string):Awaitable<TeamMemory[]>;
 getMemories(actor:string,pool:string,ids:string[]):Awaitable<Memory[]>;
 exportBundle(actor:string,pool:string,ids:string[]):Awaitable<Bundle>;
 recordShare(actor:string,pool:string,shareId:string,ids:string[]):Awaitable<void>;
 listShares(actor:string,pool:string):Awaitable<TeamShare[]>;
 authorizeShareRevocation(actor:string,pool:string,shareId:string):Awaitable<void>;
 setPolicy(actor:string,pool:string,scope:keyof PolicyLayers,key:string,policy:unknown):Awaitable<void>;
 getPolicies(actor:string,pool:string,repository?:string,conversation?:string):Awaitable<PolicyLayers>;
 index(actor:string,pool:string,provider:EmbeddingProvider):Promise<number>;
 search(actor:string,pool:string,query:string,provider:EmbeddingProvider,limit?:number):Promise<Hit[]>;
 listSharePage?(actor:string,pool:string,options?:{limit?:number;cursor?:string}):Promise<SharePage>;
 rotatePersonalToken?(actor:string):Promise<{token:string}>;
 listMemoryPage?(actor:string,pool:string,options?:{limit?:number;cursor?:string}):Awaitable<MemoryPage>;
 createShare?(actor:string,pool:string,input:ShareInput & {ids:string[]}):Promise<Snapshot>;
}
export interface ShareRepository {
 close():Awaitable<void>;
 create(value:unknown):Awaitable<Snapshot>;
 get(id:string):Awaitable<Snapshot>;
 list():Awaitable<ShareSummary[]>;
 updateContent(id:string,value:unknown):Awaitable<Snapshot>;
 revoke(id:string):Awaitable<void>;
 invitation(id:string,email:string):Awaitable<string>;
 challenge(id:string,email:string,mailer:Mailer):Promise<void>;
 verify(id:string,email:string,code:string):Awaitable<string>;
 authorize(id:string,token:string):Awaitable<Snapshot>;
}
export interface DeliveryRepository {
 reserveCode(email:string):Awaitable<void>;
 send(actor:string,share:string,messages:InvitationMessage[],mailer:SecureMailer):Awaitable<DeliveryStatus[]>;
 status(share:string):Awaitable<DeliveryStatus[]>;
 statuses(shares:string[]):Awaitable<Map<string,DeliveryStatus[]>>;
 runBatch?(mailer:SecureMailer,limit?:number):Promise<number>;
 checkVerification?(action:'code'|'verify',address:string,scope:string):Promise<void>;
}
export type {DeliveryStatus,InvitationMessage};
