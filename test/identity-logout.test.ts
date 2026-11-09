import test from 'node:test';
import assert from 'node:assert/strict';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createIdentityRoutes} from '../src/identity-routes.js';
import {CognitoAuth} from '../src/cognito.js';
import {TeamStore} from '../src/team-store.js';
test('sign-out destroys the app session and returns the trusted Cognito sign-out destination',async()=>{
 const store=new TeamStore(':memory:'),user=store.createUser('fixture').user,token='a'.repeat(64);let destroyed=false;
 const cognito=new CognitoAuth({issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fixture',clientId:'fixture',domain:'https://fixture.auth.us-east-1.amazoncognito.com',publicUrl:'https://pensieve.example.com'},{put:async()=>{},take:async()=>undefined});
 const routes=createIdentityRoutes(store,{ownerToken:'o'.repeat(40),publicUrl:'https://pensieve.example.com',emailReady:false,cognito,sessionStore:{create:async()=>token,get:async()=>({userId:user.id}),destroy:async value=>{assert.equal(value,token);destroyed=true;},revokeUser:async()=>{},linkIdentity:async()=>user}},{body:async()=>({}),HttpError:class extends Error{constructor(public status:number,message:string){super(message);}}});
 let payload='',cookie='';const response={setHeader:(name:string,value:string)=>{if(name==='Set-Cookie')cookie=value;},writeHead:(status:number)=>{assert.equal(status,200);},end:(body:string)=>{payload=body;}} as unknown as ServerResponse;
 try{await routes.team({method:'POST',headers:{cookie:'pensieve_session='+token,origin:'https://pensieve.example.com'}} as IncomingMessage,response,new URL('https://pensieve.example.com/api/team/logout'),undefined);assert.equal(destroyed,true);assert.match(cookie,/Max-Age=0/);assert.equal(JSON.parse(payload).logoutUrl,cognito.logoutUrl());}finally{store.close();}
});
