import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {awsIdentityFixture} from './aws-identity-fixture.js';
import {AwsTeamStore} from '../src/aws-team-store.js';
import {AwsLoginStates,AwsHostedSessions} from '../src/aws-sessions.js';
import {AwsConnectorStorage} from '../src/aws-connector-storage.js';
const table=process.env.PENSIEVE_AWS_TEST_TABLE;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
test('AC6 AWS login state is browser bound, expiring and atomically single use',{skip:!table},async t=>{
 const fixture=awsIdentityFixture();t.after(fixture.close);const store=new AwsLoginStates(fixture.db),digest=hash(randomUUID()),browser=hash(randomUUID()),state={digest,browser,verifier:'verifier',nonce:'nonce',returnTo:'/',expires:Date.now()+60000};await store.put(state);
 assert.equal(await store.take(digest,'wrong',Date.now()),undefined);
 const results=await Promise.all([store.take(digest,browser,Date.now()),store.take(digest,browser,Date.now())]);assert.equal(results.filter(Boolean).length,1);
 const expired=hash(randomUUID());await store.put({...state,digest:expired,expires:Date.now()-1});assert.equal(await store.take(expired,browser,Date.now()),undefined);
});
test('AC6 AWS sessions persist, cap active sessions, revoke and prove legacy linking',{skip:!table},async t=>{
 const fixture=awsIdentityFixture();t.after(fixture.close);const database=fixture.db,team=await AwsTeamStore.open(database),legacy=await team.createUser('legacy-'+randomUUID()),identity={issuer:'fixture',subject:randomUUID(),email:'fixture@example.com'};
 const fresh=await team.accessUser(identity.issuer,identity.subject,identity.email),sessions=new AwsHostedSessions(database);
 const oldSession=await sessions.create(fresh.id,identity);assert.equal((await new AwsHostedSessions(database).get(oldSession))?.userId,fresh.id);
 assert.equal((await sessions.linkIdentity(identity,legacy.token)).id,legacy.user.id);assert.equal(await sessions.get(oldSession),undefined);
 const tokens=[];for(let i=0;i<6;i++)tokens.push(await sessions.create(legacy.user.id,identity));assert.equal((await Promise.all(tokens.map(t=>sessions.get(t)))).filter(Boolean).length,5);
 await sessions.destroy(tokens[5]);assert.equal(await sessions.get(tokens[5]),undefined);
 await sessions.revokeUser(legacy.user.id);assert.equal(await sessions.get(tokens[4]),undefined);
 const usedIdentity={issuer:'fixture',subject:randomUUID(),email:'used@example.com'},used=await team.accessUser(usedIdentity.issuer,usedIdentity.subject,usedIdentity.email);await team.createPool(used.id,'Existing','private');await assert.rejects(sessions.linkIdentity(usedIdentity,legacy.token),/existing data/);
});
test('AC7 AWS connector consumes atomically and expires inactive registrations',{skip:!table},async t=>{
 const fixture=awsIdentityFixture();t.after(fixture.close);let now=Date.now()+86400000*2;const store=new AwsConnectorStorage(fixture.db,()=>now),id=randomUUID();
 await store.registerClient({table:'connector_clients',key:id,row:{body:JSON.stringify({client_id:id,client_id_issued_at:Math.floor(now/1000)})}},now);
 const pending={table:'connector_pending' as const,key:randomUUID(),row:{body:JSON.stringify({clientId:id}),expires:now+300000}};await store.insert(pending,2000);
 const next={table:'connector_codes' as const,key:randomUUID(),row:{body:pending.row.body,expires:now+300000}};
 assert.deepEqual((await Promise.all([store.consume(pending,now,next),store.consume(pending,now,next)])).sort(),[false,true]);assert.ok(await store.get('connector_codes',next.key));
 now+=86400001;assert.equal(await store.get('connector_clients',id),undefined);assert.equal(await store.get('connector_codes',next.key),undefined);
});
test('AC7 AWS registration rejects a full minute without publishing a client and recovers next window',{skip:!table},async t=>{
 const f=awsIdentityFixture();t.after(f.close);let now=Math.floor((Date.now()+86400000*3)/60000)*60000;const store=new AwsConnectorStorage(f.db,()=>now),minute=Math.floor(now/60000);
 await f.db.put({pk:'CONNECTOR-RATE#registrations-minute',sk:String(minute),count:100,ttl:Math.ceil((now+86400000)/1000)});
 const id=randomUUID(),entry={table:'connector_clients' as const,key:id,row:{body:JSON.stringify({client_id:id,client_id_issued_at:Math.floor(now/1000)})}};
 await assert.rejects(store.registerClient(entry,now),/capacity/);assert.equal(await store.get('connector_clients',id),undefined);now+=60000;await store.registerClient(entry,now);assert.ok(await store.get('connector_clients',id));
});
