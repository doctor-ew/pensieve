import assert from 'node:assert/strict';
const base=process.env.PENSIEVE_PROOF_URL,token=process.env.PENSIEVE_PROOF_TOKEN;
if(!base||!token)throw Error('Explicit proof URL and personal token required');
// Pace smoke checks below the deployed API throttle; never retry mutations blindly.
const nativeFetch=globalThis.fetch;
const fetch:typeof globalThis.fetch=async(input,init)=>{await new Promise(resolve=>setTimeout(resolve,500));return nativeFetch(input,init);};
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:base};
async function request(path:string,method='GET',body?:unknown,auth=true){const response=await fetch(base+path,{method,headers:auth?headers:{},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);return data;}
assert.equal((await request('/health')).status,'ok');
const me=await request('/api/team/me');assert.ok(me.user.id);
const {pools}=await request('/api/team/pools');const pool=pools.find((p:{name:string})=>p.name==='pensive');assert.ok(pool,'Migrated pensive pool required');
const page=await request(`/api/team/pools/${pool.id}/memories`);assert.equal(page.memories.length,9);
const ids=[page.memories[0].memory.id];let shareId:string|undefined;
try{
 const share=await request(`/api/team/pools/${pool.id}/shares`,'POST',{ids,title:'AWS deployment verification',brief:'Selected-memory sharing verification; revoked after the check.',recipients:['drew@doctorew.com'],days:1,accessMode:'invitation-link',cloudAllowed:false});shareId=share.id;
 const invitation=new URL(share.invitations[0].url);const grant=invitation.hash.slice(1);assert.ok(grant);
 const unauthorized=await fetch(`${base}/api/reader/${share.id}`);assert.equal(unauthorized.status,401);
 const reader=await fetch(`${base}/api/reader/${share.id}`,{headers:{Authorization:`Bearer ${grant}`}});assert.equal(reader.status,200);const shared=await reader.json();assert.equal(shared.memories.length,1);assert.equal(shared.memories[0].id,ids[0]);
 const download=await fetch(`${base}/api/reader/${share.id}/download`,{headers:{Authorization:`Bearer ${grant}`}});assert.equal(download.status,200);assert.equal((await download.json()).format,'pensieve/v1');
 await request(`/api/team/pools/${pool.id}/shares/${share.id}/revoke`,'POST',{});
 assert.equal((await fetch(`${base}/api/reader/${share.id}`,{headers:{Authorization:`Bearer ${grant}`}})).status,401);
 shareId=undefined;
 console.log(JSON.stringify({health:true,personalCredential:true,pools:pools.length,pensiveMemories:9,selectedShare:true,unauthenticatedDenied:true,download:true,revocation:true}));
}finally{if(shareId)await request(`/api/team/pools/${pool.id}/shares/${shareId}/revoke`,'POST',{});}
