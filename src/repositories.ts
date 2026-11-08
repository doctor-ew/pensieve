import type {TeamStore,TeamMemory} from './team-store.js';
import type {ShareStore,ShareInput,Snapshot} from './executive.js';
import type {DeliveryLedger,DeliveryStatus,InvitationMessage,SecureMailer} from './delivery.js';
export type Awaitable<T> = T | Promise<T>;
type AwaitableMethods<T> = {[K in keyof T]: T[K] extends (...args:infer A)=>infer R ? (...args:A)=>Awaitable<Awaited<R>> : T[K]};
export interface MemoryPage {memories:TeamMemory[];nextCursor?:string}
export interface SharePage {shares:{id:string;title:string;recipients:string[];expiresAt:number;revoked:boolean;count:number}[];nextCursor?:string}
export type TeamRepository = AwaitableMethods<TeamStore> & {
 listSharePage?(actor:string,pool:string,options?:{limit?:number;cursor?:string}):Promise<SharePage>;
 rotatePersonalToken?(actor:string):Promise<{token:string}>;
 listMemoryPage?(actor:string,pool:string,options?:{limit?:number;cursor?:string}):Awaitable<MemoryPage>;
 createShare?(actor:string,pool:string,input:ShareInput & {ids:string[]}):Promise<Snapshot>;
};
export type ShareRepository = AwaitableMethods<Omit<ShareStore,'db'>>;
export type DeliveryRepository = Pick<AwaitableMethods<DeliveryLedger>,'reserveCode'|'send'|'status'|'statuses'> & {
 runBatch?(mailer:SecureMailer,limit?:number):Promise<number>;
 checkVerification?(action:'code'|'verify',address:string,scope:string):Promise<void>;
};
export type {DeliveryStatus,InvitationMessage};
