import {createHash,randomBytes} from 'node:crypto';
import {DeleteCommand,QueryCommand,TransactWriteCommand,UpdateCommand,type TransactWriteCommandInput} from '@aws-sdk/lib-dynamodb';
import type {AwsDatabase} from './aws-db.js';
import type {CognitoIdentity,LoginState,LoginStates} from './cognito.js';
import type {HostedSession,HostedSessions} from './hosted-sessions.js';
import {TeamAccessError,type TeamUser} from './team-store.js';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const identityKey=(i:CognitoIdentity)=>`IDENTITY#${digest(JSON.stringify([i.issuer,i.subject]))}`;
const conditional=(error:unknown)=>error instanceof Error&&['ConditionalCheckFailedException','TransactionCanceledException'].includes(error.name);
type Actions=NonNullable<TransactWriteCommandInput['TransactItems']>;

/** Browser-bound, one-use states. TTL is cleanup only: every read checks logical expiry. */
export class AwsLoginStates implements LoginStates {
 constructor(private readonly db:AwsDatabase,private readonly now=Date.now){}
 async put(state:LoginState):Promise<void>{
  const now=this.now(),window=Math.floor(now/60000);
  const counter=(pk:string,max:number)=>({Update:{TableName:this.db.table,Key:{pk,sk:String(window)},UpdateExpression:'SET #ttl = :expiry ADD #n :one',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':expiry':Math.ceil((now+360000)/1000),':one':1,':max':max}}});
  try{await this.db.client.send(new TransactWriteCommand({TransactItems:[counter('LOGIN-RATE#global',500),counter('LOGIN-RATE#'+state.browser,5),{Put:{TableName:this.db.table,Item:{pk:'LOGIN#'+state.browser,sk:state.digest,...state,expiresAt:state.expires,ttl:Math.ceil(state.expires/1000)},ConditionExpression:'attribute_not_exists(pk)'}}]}));}
  catch(error){if(conditional(error))throw Error('Sign-in capacity reached; try again shortly');throw error;}
 }
 async take(hash:string,browser:string,now:number):Promise<LoginState|undefined>{
  try{const result=await this.db.client.send(new DeleteCommand({TableName:this.db.table,Key:{pk:'LOGIN#'+browser,sk:hash},ConditionExpression:'expiresAt > :now',ExpressionAttributeValues:{':now':now},ReturnValues:'ALL_OLD'}));const row=result.Attributes;return row?{digest:row.digest,browser:row.browser,verifier:row.verifier,nonce:row.nonce,returnTo:row.returnTo,expires:row.expiresAt} as LoginState:undefined;}
  catch(error){if(conditional(error))return;throw error;}
 }
}

/** Sessions contain only opaque credential hashes, with a per-user revocation epoch. */
export class AwsHostedSessions implements HostedSessions {
 constructor(private readonly db:AwsDatabase,private readonly now=Date.now){}
 async create(userId:string,identity?:CognitoIdentity):Promise<string>{
  for(let attempt=0;attempt<5;attempt++){
   const user=await this.db.get('USER#'+userId,'META');if(!user?.active)throw new TeamAccessError(401,'Unauthorized identity');
   const token=randomBytes(32).toString('hex'),hash=digest(token),now=this.now();
   const prior=(await this.db.client.send(new QueryCommand({TableName:this.db.table,KeyConditionExpression:'pk = :pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'USER#'+userId,':prefix':'SESSION#'},ConsistentRead:true,Limit:6}))).Items??[];
   const old=prior.filter(row=>Number(row.expiresAt)<=now).concat(prior.filter(row=>Number(row.expiresAt)>now).sort((a,b)=>Number(a.created)-Number(b.created)).slice(0,Math.max(0,prior.filter(row=>Number(row.expiresAt)>now).length-4)));
   const actions:Actions=[{Update:{TableName:this.db.table,Key:{pk:'USER#'+userId,sk:'META'},UpdateExpression:'SET #v = :next',ConditionExpression:'active = :active AND #v = :version',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':active':true,':version':user.version,':next':Number(user.version)+1}}}];
   if(identity)actions.push({ConditionCheck:{TableName:this.db.table,Key:{pk:identityKey(identity),sk:'META'},ConditionExpression:'actor = :actor',ExpressionAttributeValues:{':actor':userId}}});
   for(const row of old){actions.push({Delete:{TableName:this.db.table,Key:{pk:row.pk,sk:row.sk}}},{Delete:{TableName:this.db.table,Key:{pk:'SESSION#'+String(row.digest),sk:'META'}}});}
   const body={actor:userId,...(identity?{identity}:{}),epoch:Number(user.sessionEpoch??0),created:now,expiresAt:now+43200000,ttl:Math.ceil((now+43200000)/1000)};
   actions.push({Put:{TableName:this.db.table,Item:{pk:'SESSION#'+hash,sk:'META',...body},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:this.db.table,Item:{pk:'USER#'+userId,sk:'SESSION#'+hash,digest:hash,...body}}});
   try{await this.db.client.send(new TransactWriteCommand({TransactItems:actions}));return token;}catch(error){if(!conditional(error)||attempt===4)throw error;}
  }throw Error('Session contention');
 }
 async get(token:string):Promise<HostedSession|undefined>{
  if(!/^[a-f0-9]{64}$/.test(token))return;const row=await this.db.get('SESSION#'+digest(token),'META');if(!row||Number(row.expiresAt)<=this.now())return;
  const user=await this.db.get('USER#'+row.actor,'META');if(!user?.active||Number(user.sessionEpoch??0)!==Number(row.epoch))return;
  const identity=row.identity as CognitoIdentity|undefined;if(identity&&(await this.db.get(identityKey(identity),'META'))?.actor!==row.actor)return;
  return {userId:String(row.actor),...(identity?{identity}:{})};
 }
 async destroy(token:string):Promise<void>{
  if(!/^[a-f0-9]{64}$/.test(token))return;const hash=digest(token),row=await this.db.get('SESSION#'+hash,'META');if(!row)return;
  await this.db.client.send(new TransactWriteCommand({TransactItems:[{Delete:{TableName:this.db.table,Key:{pk:'SESSION#'+hash,sk:'META'}}},{Delete:{TableName:this.db.table,Key:{pk:'USER#'+row.actor,sk:'SESSION#'+hash}}}]}));
 }
 async revokeUser(userId:string):Promise<void>{await this.db.client.send(new UpdateCommand({TableName:this.db.table,Key:{pk:'USER#'+userId,sk:'META'},UpdateExpression:'ADD sessionEpoch :one, #v :one',ConditionExpression:'attribute_exists(pk)',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':one':1}}));}
 async linkIdentity(identity:CognitoIdentity,personalToken:string):Promise<TeamUser>{
  if(!personalToken||personalToken.length>512||!identity.issuer||!identity.subject||!identity.email)throw new TeamAccessError(401,'Both account credentials are required');
  const hash=digest(personalToken),mapping=await this.db.get('TOKEN#'+hash,'META'),user=mapping?await this.db.get('USER#'+mapping.actor,'META'):undefined;
  if(!user?.active||user.token!==hash)throw new TeamAccessError(401,'Invalid personal credential');
  const pk=identityKey(identity),old=await this.db.get(pk,'META');
  const actions:Actions=[{ConditionCheck:{TableName:this.db.table,Key:{pk:'USER#'+user.id,sk:'META'},ConditionExpression:'active = :active AND #token = :token AND #v = :version',ExpressionAttributeNames:{'#v':'version','#token':'token'},ExpressionAttributeValues:{':active':true,':token':hash,':version':user.version}}}];
  if(old?.actor&&old.actor!==user.id){
   const source=await this.db.get('USER#'+old.actor,'META');if(!source||source.used)throw new TeamAccessError(403,'This signed-in account has existing data; linking would hide it. Export or transfer it before linking.');
   actions.push({Update:{TableName:this.db.table,Key:{pk:'USER#'+old.actor,sk:'META'},UpdateExpression:'SET #v = :next ADD sessionEpoch :one',ConditionExpression:'#v = :version AND (attribute_not_exists(used) OR used = :unused)',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':version':source.version,':next':Number(source.version)+1,':one':1,':unused':false}}});
  }
  actions.push({Put:{TableName:this.db.table,Item:{pk,sk:'META',issuer:identity.issuer,subject:identity.subject,actor:user.id},ConditionExpression:old?'actor = :old':'attribute_not_exists(pk)',...(old?{ExpressionAttributeValues:{':old':old.actor}}:{})}});
  try{await this.db.client.send(new TransactWriteCommand({TransactItems:actions}));}catch(error){if(conditional(error))throw new TeamAccessError(403,'Account changed; sign in again before linking');throw error;}
  return {id:String(user.id),name:String(user.name)};
 }
}
