import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {chromium} from '@playwright/test';
import {TeamStore} from '../src/team-store.js';
import {createTeamServer} from '../src/team-server.js';
import {CognitoAuth} from '../src/cognito.js';
import type {HostedSession} from '../src/hosted-sessions.js';

test('Cognito cross-site callback carries the new session to a protected return page',async()=>{
 const store=new TeamStore(':memory:'),sessions=new Map<string,HostedSession>();
 const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const addr=probe.address();assert.ok(addr&&typeof addr!=='string');await new Promise<void>(resolve=>probe.close(()=>resolve()));const base='http://127.0.0.1:'+addr.port;
 const cognito=new CognitoAuth({issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fixture',clientId:'fixture',domain:'https://fixture.auth.us-east-1.amazoncognito.com',publicUrl:base},{put:async()=>{},take:async()=>undefined});
 // Signature/state verification has separate adversarial tests. This exercises real browser cookie/redirect behavior after a successful verification.
 cognito.complete=async()=>({identity:{issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_fixture',subject:'verified-fixture',email:'drew@doctorew.com'},returnTo:'/admin'});
 const server=createTeamServer(store,{publicUrl:base,ownerToken:'o'.repeat(40),cognito,sessionStore:{create:async(userId,identity)=>{const token='a'.repeat(64);sessions.set(token,{userId,identity});return token;},get:async token=>sessions.get(token),destroy:async token=>{sessions.delete(token);},revokeUser:async()=>{},linkIdentity:async()=>{throw Error('unused');}},handleExtra:async(req,res)=>{if(req.url!=='/admin')return false;const token=/pensieve_session=([a-f0-9]{64})/.exec(req.headers.cookie??'')?.[1];const session=token?sessions.get(token):undefined;res.writeHead(session?200:401,{'Content-Type':'text/plain'});res.end(session?'Owner signed in':'Missing session after callback');return true;}});
 await new Promise<void>(resolve=>server.listen(addr.port,'127.0.0.1',resolve));
 const provider=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<a href="'+base+'/auth/callback?code=fixture&state=fixture">Finish sign-in</a>');});await new Promise<void>(resolve=>provider.listen(0,resolve));const pa=provider.address();assert.ok(pa&&typeof pa!=='string');
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
 try{const page=await browser.newPage();await page.goto('http://localhost:'+pa.port);await page.getByRole('link',{name:'Finish sign-in'}).click();await page.waitForURL(base+'/admin');assert.equal(await page.locator('body').innerText(),'Owner signed in');}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise<void>(resolve=>provider.close(()=>resolve()));store.close();}
});
