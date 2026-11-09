import {BatchGetCommand,GetCommand,PutCommand,DeleteCommand,QueryCommand,TransactWriteCommand,type DynamoDBDocumentClient,type TransactWriteCommandInput} from '@aws-sdk/lib-dynamodb';
export interface AwsKey {pk:string;sk:string}
export type AwsItem=AwsKey & Record<string,unknown>;
export type AwsWrite=NonNullable<TransactWriteCommandInput['TransactItems']>[number];
export interface AwsPage<T extends AwsItem=AwsItem>{items:T[];cursor?:string}
export class AwsDatabase {
 constructor(readonly client:DynamoDBDocumentClient,readonly table:string){if(!table)throw Error('DynamoDB table required');}
 async get<T extends AwsItem=AwsItem>(pk:string,sk:string):Promise<T|undefined>{const r=await this.client.send(new GetCommand({TableName:this.table,Key:{pk,sk},ConsistentRead:true}));return r.Item as T|undefined;}
 async put(item:AwsItem,condition?:string,values?:Record<string,unknown>):Promise<void>{await this.client.send(new PutCommand({TableName:this.table,Item:item,...(condition?{ConditionExpression:condition}:{}),...(values?{ExpressionAttributeValues:values}:{})}));}
 async delete(pk:string,sk:string):Promise<void>{await this.client.send(new DeleteCommand({TableName:this.table,Key:{pk,sk}}));}
 async query<T extends AwsItem=AwsItem>(pk:string,options:{prefix?:string;after?:string;limit?:number}={}):Promise<AwsPage<T>>{
  const limit=options.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Query page limit must be 1..100');
  const r=await this.client.send(new QueryCommand({TableName:this.table,ConsistentRead:true,KeyConditionExpression:options.prefix?'pk=:pk AND begins_with(sk,:prefix)':'pk=:pk',ExpressionAttributeValues:{':pk':pk,...(options.prefix?{':prefix':options.prefix}:{})},Limit:limit,...(options.after?{ExclusiveStartKey:{pk,sk:options.after}}:{})}));
  return {items:(r.Items??[]) as T[],...(r.LastEvaluatedKey?{cursor:String(r.LastEvaluatedKey.sk)}:{})};
 }
 async batchGet<T extends AwsItem=AwsItem>(keys:AwsKey[]):Promise<T[]>{
  const unique=[...new Map(keys.map(k=>[JSON.stringify(k),k])).values()],result:T[]=[];
  for(let offset=0;offset<unique.length;offset+=100){let pending=unique.slice(offset,offset+100);for(let attempt=0;pending.length&&attempt<6;attempt++){
   const r=await this.client.send(new BatchGetCommand({RequestItems:{[this.table]:{Keys:pending,ConsistentRead:true}}}));result.push(...(r.Responses?.[this.table]??[]) as T[]);pending=(r.UnprocessedKeys?.[this.table]?.Keys??[]) as AwsKey[];
   if(pending.length)await new Promise(resolve=>setTimeout(resolve,Math.min(1000,25*2**attempt)));
  }if(pending.length)throw Error('DynamoDB batch read incomplete');}return result;
 }
 async transact(actions:AwsWrite[],token?:string):Promise<void>{if(!actions.length||actions.length>100)throw Error('Transaction must contain 1..100 actions');await this.client.send(new TransactWriteCommand({TransactItems:actions,...(token?{ClientRequestToken:token}:{})}));}
 putAction(item:AwsItem,condition?:string,values?:Record<string,unknown>):AwsWrite{return {Put:{TableName:this.table,Item:item,...(condition?{ConditionExpression:condition}:{}),...(values?{ExpressionAttributeValues:values}:{})}};}
 check(pk:string,sk:string,condition:string,values?:Record<string,unknown>):AwsWrite{return {ConditionCheck:{TableName:this.table,Key:{pk,sk},ConditionExpression:condition,...(values?{ExpressionAttributeValues:values}:{})}};}
}
export function conditionalFailure(error:unknown):boolean{return error instanceof Error&&['ConditionalCheckFailedException','TransactionCanceledException'].includes(error.name);}
