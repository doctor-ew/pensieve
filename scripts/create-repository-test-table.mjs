import {DynamoDBClient,CreateTableCommand} from '@aws-sdk/client-dynamodb';
const endpoint=process.env.PENSIEVE_REPOSITORY_TEST_ENDPOINT;
if(!endpoint||new URL(endpoint).hostname!=='127.0.0.1')throw Error('Disposable loopback DynamoDB endpoint required');
const client=new DynamoDBClient({endpoint,region:'us-east-1',credentials:{accessKeyId:'local',secretAccessKey:'local'},maxAttempts:5});
try{await client.send(new CreateTableCommand({TableName:'repository_test',BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'pk',AttributeType:'S'},{AttributeName:'sk',AttributeType:'S'}],KeySchema:[{AttributeName:'pk',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}]}));}finally{client.destroy();}
