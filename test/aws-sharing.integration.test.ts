import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {awsIdentityFixture} from './aws-identity-fixture.js';
import {AwsTeamStore} from '../src/aws-team-store.js';
import {AwsShareStore} from '../src/aws-share-store.js';
import {AwsDeliveryLedger} from '../src/aws-delivery.js';
import {makeMemory} from '../src/sessions.js';
import type {SecureMailer} from '../src/delivery.js';
const enabled=!!(process.env.PENSIEVE_AWS_TEST_TABLE&&process.env.PENSIEVE_AWS_TEST_SNAPSHOT_BUCKET);
test('AC8 AWS snapshot grants, code attempts and revocation use authoritative state',{skip:!enabled},async t=>{
 const f=awsIdentityFixture();t.after(f.close);const shares=new AwsShareStore(f.db,f.s3,f.bucket),team=await AwsTeamStore.open(f.db,{prepareSnapshot:v=>shares.prepareSnapshot(v)}),user=await team.createUser(randomUUID()),pool=await team.createPool(user.user.id,'Fixture','private');
 const memory=makeMemory({text:'Selected fixture only',source:'manual',session:randomUUID(),role:'user',timestamp:'',locator:'fixture',project:'fixture'});await team.putMemory(user.user.id,pool.id,memory);const bundle=await team.exportBundle(user.user.id,pool.id,[memory.id]);
 const snapshot=await team.createShare(user.user.id,pool.id,{title:'Fixture',brief:'Reviewed fixture',days:1,recipients:['friend@example.com'],cloudAllowed:false,bundle,accessMode:'invitation-link',ids:[memory.id]});
 const grant=await shares.invitation(snapshot.id,'friend@example.com');assert.equal((await shares.authorize(snapshot.id,grant)).bundle.memories[0].id,memory.id);await assert.rejects(shares.invitation(snapshot.id,'stranger@example.com'));
 await shares.updateContent(snapshot.id,{title:'Corrected',brief:'Reviewed correction',bundle});assert.equal((await shares.authorize(snapshot.id,grant)).title,'Corrected');
 let code='';await shares.challenge(snapshot.id,'friend@example.com',{sendCode:async(_email,value)=>{code=value;}});assert.ok(code);await assert.rejects(shares.verify(snapshot.id,'friend@example.com','wrong'));const results=await Promise.allSettled([shares.verify(snapshot.id,'friend@example.com',code),shares.verify(snapshot.id,'friend@example.com',code)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await shares.revoke(snapshot.id);await assert.rejects(shares.authorize(snapshot.id,grant));
});
test('AC9 AWS delivery deduplicates, fails closed on revocation and preserves ambiguous sends',{skip:!enabled},async t=>{
 const f=awsIdentityFixture();t.after(f.close);const shares=new AwsShareStore(f.db,f.s3,f.bucket),team=await AwsTeamStore.open(f.db,{prepareSnapshot:v=>shares.prepareSnapshot(v)}),user=await team.createUser(randomUUID()),pool=await team.createPool(user.user.id,'Fixture','private');
 const memory=makeMemory({text:'Delivery fixture',source:'manual',session:randomUUID(),role:'user',timestamp:'',locator:'fixture',project:'fixture'});await team.putMemory(user.user.id,pool.id,memory);const bundle=await team.exportBundle(user.user.id,pool.id,[memory.id]);
 const create=()=>team.createShare(user.user.id,pool.id,{title:'Fixture',brief:'Reviewed fixture',days:1,recipients:['friend@example.com'],cloudAllowed:false,bundle,accessMode:'invitation-link',ids:[memory.id]});
 const snapshot=await create(),ledger=new AwsDeliveryLedger(f.db,shares,team),messages=[{email:'friend@example.com',title:'UNTRUSTED',url:'https://fixture.example/s/'+snapshot.id,expiresAt:0,verified:false}];let sends=0;
 const mailer:SecureMailer={sendCode:async()=>{},sendInvitation:async message=>{sends++;assert.equal(message.title,'Fixture');assert.match(message.url,/#/);throw Error('Ambiguous after accept');}};
 await ledger.send(user.user.id,snapshot.id,messages,mailer);await ledger.send(user.user.id,snapshot.id,messages,mailer);assert.equal(sends,0);assert.equal(await ledger.runBatch(mailer),1);assert.equal(sends,1);assert.equal((await ledger.status(snapshot.id))[0].status,'unknown');assert.equal(await ledger.runBatch(mailer),0);
 const second=await create();await ledger.send(user.user.id,second.id,[{...messages[0],url:'https://fixture.example/s/'+second.id}],mailer);await shares.revoke(second.id);await ledger.runBatch(mailer);assert.equal(sends,1);assert.equal((await ledger.status(second.id))[0].status,'cancelled');
 const recipients=['first+'+randomUUID()+'@example.com','second+'+randomUUID()+'@example.com'];
 const partial=await team.createShare(user.user.id,pool.id,{title:'Partial',brief:'Reviewed fixture',days:1,recipients,cloudAllowed:false,bundle,accessMode:'invitation-link',ids:[memory.id]});
 const quotaPk='MAIL-QUOTA#'+createHash('sha256').update('email:'+recipients[1]).digest('hex');
 await f.db.put({pk:quotaPk,sk:'META',times:Array(5).fill(Date.now()),version:1});
 const partialMessages=recipients.map(email=>({...messages[0],email,url:'https://fixture.example/s/'+partial.id}));
 await assert.rejects(ledger.send(user.user.id,partial.id,partialMessages,mailer),/quota/);assert.equal((await ledger.status(partial.id)).length,1);
 await f.db.put({pk:quotaPk,sk:'META',times:[],version:2});await ledger.send(user.user.id,partial.id,partialMessages,mailer);assert.equal((await ledger.status(partial.id)).length,2);
 const firstQuota='MAIL-QUOTA#'+createHash('sha256').update('email:'+recipients[0]).digest('hex');assert.equal(((await f.db.get(firstQuota,'META'))!.times as number[]).length,1);

});
