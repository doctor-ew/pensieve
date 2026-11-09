import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from '@playwright/test';
const base=process.env.PENSIEVE_PROOF_URL;
if(!base)throw Error('Explicit PENSIEVE_PROOF_URL required');
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/');await page.getByRole('link',{name:'Connect your AI',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('#steps li').length>0);
 assert.equal(new URL(page.url()).pathname,'/connect');
 assert.equal(await page.locator('#provider option').count(),6);
 for(const provider of ['chatgpt','claude','codex','muse','grok','open']){await page.locator('#provider').selectOption(provider);assert.ok(await page.locator('#steps li').count()>0);}
 await page.locator('#check-service').click();await page.waitForFunction(()=>document.getElementById('check-status')?.textContent?.includes('reachable'));
 assert.match(await page.locator('#check-status').innerText(),/inside your chat/);
 const admin=await fetch(base+'/admin',{redirect:'manual'});assert.equal(admin.status,302);assert.match(admin.headers.get('location'),/^\/auth\/login/);
 assert.equal((await fetch(base+'/api/admin/me')).status,401);
 assert.equal((await fetch(base+'/api/admin/users',{headers:{Authorization:'Bearer invalid','x-user-email':'drew@doctorew.com'}})).status,401);
 const signup=await fetch(base+'/auth/signup',{redirect:'manual'});assert.equal(signup.status,302);assert.equal(new URL(signup.headers.get('location')).pathname,'/signup');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'/tmp/pensieve-connect-production.png',fullPage:true});
 console.log(JSON.stringify({onboarding:true,providers:6,discovery:true,anonymousAdminDenied:true,spoofedAdminDenied:true,signup:true,browserErrors:0}));
} finally {await browser.close();}
