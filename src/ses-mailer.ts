import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import {emailAddress} from './executive.js';
import type {SecureMailer} from './delivery.js';
export function sesMailerFromEnv():SecureMailer|undefined{
 const sender=process.env.PENSIEVE_EMAIL_FROM,region=process.env.PENSIEVE_SES_REGION;
 if(!region)return;
 if(!sender)throw Error('PENSIEVE_EMAIL_FROM required for SES');
 const from=emailAddress(sender);const client=new SESv2Client({region,maxAttempts:1});
 async function send(to:string,subject:string,text:string){
 await client.send(new SendEmailCommand({FromEmailAddress:from,Destination:{ToAddresses:[emailAddress(to)]},Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}}}}}),{abortSignal:AbortSignal.timeout(15000)});
 }
 return {
 sendCode:(email,code)=>send(email,'Your Pensieve sign-in code','Your code is '+code+'. It expires in 10 minutes. If you did not request it, ignore this email.'),
 sendInvitation:m=>send(m.email,'Pensieve: '+m.title,'You have been invited to view "'+m.title+'".\n\n'+m.url+'\n\n'+(m.verified?'Verify your invited email address to open these memories.':'Anyone with this complete link can open these memories.')+'\nAccess ends '+new Date(m.expiresAt).toISOString()+'.'),
 };
}
