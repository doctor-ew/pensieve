import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { chromium, expect, type Download } from '@playwright/test';
import { TeamStore } from '../src/team-store.js';
import { ShareStore } from '../src/executive.js';
import { createTeamServer } from '../src/team-server.js';

async function downloadText(download: Download) {
  const stream = await download.createReadStream(); assert.ok(stream); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

test('isolated browser creates, saves, curates, shares and downloads synthetic memories', { timeout: 60_000 }, async () => {
  const socket = netServer(); await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const addr = socket.address(); assert.ok(addr && typeof addr !== 'string'); const port = addr.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const store = new TeamStore(':memory:'); const shares = new ShareStore(':memory:');
  const creator = store.createUser('Synthetic Executive'); const ownerToken = 'synthetic-operator-'.repeat(4);
  const server = createTeamServer(store, { ownerToken, publicUrl: base, shareStore: shares, provider: { identity: 'synthetic:test-browser', embed: async texts => texts.map(() => [1, 0]) } });
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PENSIEVE_TEST_BROWSER ?? (existsSync(installedChrome) ? installedChrome : undefined) }).catch(async error => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); shares.close(); throw error; });
  const context = await browser.newContext({ acceptDownloads: true }); const page = await context.newPage();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/#token=' + creator.token);
    await expect(page.locator('#workspace')).toBeVisible(); await expect(page.locator('#status')).toHaveText('Ready');
    assert.equal(new URL(page.url()).hash, '');
    await page.locator('#pool-name').fill('Synthetic roadmap'); await page.locator('#create-pool button').click();
    await expect(page.locator('#pool-tools')).toBeVisible(); await expect(page.locator('#status')).toHaveText('Ready');
    const included = 'Synthetic decision: use a shared memory pool. <script>window.compromised=true</script>';
    const excluded = 'Synthetic private audience B detail';
    for (const text of [included, excluded]) {
      await page.locator('#add-memory').click(); await page.locator('#memory-text').fill(text); await page.locator('#project').fill('/synthetic/browser-project');
      await page.locator('#synthetic').check(); await page.locator('#capture button').click();
      await expect(page.locator('#memory-text')).toHaveValue(''); await expect(page.locator('#status')).toHaveText('Ready');
    }
    await expect(page.locator('#memories article')).toHaveCount(2);
    await expect(page.locator('#memory-count')).toHaveText('2 saved memories'); await expect(page.locator('#capture-panel')).toBeHidden(); await expect(page.locator('#share-panel')).toBeHidden(); await expect(page.locator('#download')).toBeDisabled();
    await page.locator('#select-all').click(); await expect(page.locator('#selection-count')).toHaveText('2 selected'); await page.locator('#select-all').click();
    await page.reload(); await expect(page.locator('#memory-count')).toHaveText('2 saved memories'); await expect(page.locator('#capture-panel')).toBeHidden();
    const firstCard = await page.locator('#memories article').first().boundingBox(); assert.ok(firstCard && firstCard.y < 650, 'Saved memories must appear in the initial desktop viewport');
    assert.equal(await page.evaluate(() => (window as unknown as { compromised?: boolean }).compromised), undefined);
    await page.locator('#memories article').filter({ hasText: included }).locator('input').check();
    const downloadEvent = page.waitForEvent('download'); await page.locator('#download').click();
    const exported = await downloadText(await downloadEvent); assert.ok(exported.includes(included)); assert.ok(!exported.includes(excluded));
    await expect(page.locator('#status')).toHaveText('Ready');
    await page.locator('#open-share').click(); await page.locator('#share-title').fill('Synthetic executive handoff'); await page.locator('#brief').fill('Reviewed synthetic reasoning for our next build.'); await page.locator('#recipients').fill('synthetic-developer@example.com');
    await page.locator('#share button').click(); await expect(page.locator('#invitations a').first()).toBeVisible();
    const invitation = await page.locator('#invitations a[target="_blank"]').getAttribute('href'); assert.ok(invitation);
    const recipient = await browser.newContext({ acceptDownloads: true }); const reader = await recipient.newPage(); await reader.goto(invitation);
    await expect(reader.locator('#content')).toBeVisible(); await expect(reader.locator('#title')).toHaveText('Synthetic executive handoff');
    await expect(reader.locator('#reader-memories article')).toHaveCount(1);
    const recipientDownload = reader.waitForEvent('download'); await reader.locator('#download-agent').click();
    const bundle = await downloadText(await recipientDownload); assert.ok(bundle.includes(included)); assert.ok(!bundle.includes(excluded)); assert.ok(!bundle.includes(creator.token)); assert.ok(!bundle.includes(ownerToken));
    await page.locator('#shares button').click(); await expect(page.locator('#shares')).toContainText('Revoked');
    const deniedDownload = reader.waitForResponse(response => response.url().endsWith('/download'));
    await reader.locator('#download-agent').click(); assert.equal((await deniedDownload).status(), 401); await expect(reader.locator('#signin')).toBeVisible();
    await page.locator('#add-memory').click(); await page.locator('summary').filter({ hasText: 'Capture settings' }).click();
    await page.locator('#policy-destination').selectOption('private'); await page.locator('#policy-form button').click(); await expect(page.locator('#status')).toHaveText('Ready');
    await page.locator('#add-memory').click(); await page.locator('#memory-text').fill('Synthetic private override capture'); await page.locator('#capture button').click();
    await expect(page.locator('#destination')).toContainText('Private · Synthetic roadmap (private)');
    await expect(page.locator('#memories')).toContainText('Synthetic private override capture');
    const pools = store.listPools(creator.user.id); const shared = pools.find(pool => pool.visibility === 'shared')!; const privatePool = pools.find(pool => pool.visibility === 'private')!;
    assert.equal(store.listMemories(creator.user.id, shared.id).length, 2); assert.equal(store.listMemories(creator.user.id, privatePool.id).length, 1);
    await page.locator('#new-pool summary').click(); await page.locator('#pool-name').fill('Synthetic newly chosen private'); await page.locator('#visibility').selectOption('private'); await page.locator('#create-pool button').click();
    await expect(page.locator('#destination')).toContainText('Synthetic newly chosen private (private)'); await expect(page.locator('#memories article')).toHaveCount(0);
    await page.locator('#add-memory').click(); await page.locator('#memory-text').fill('Synthetic next save belongs in new pool'); await page.locator('#capture button').click(); await expect(page.locator('#memory-text')).toHaveValue('');
    const newlyChosen = store.listPools(creator.user.id).find(pool => pool.name === 'Synthetic newly chosen private')!;
    assert.equal(store.listMemories(creator.user.id, newlyChosen.id).length, 1); assert.equal(store.listMemories(creator.user.id, shared.id).length, 2);
    const readOnly = store.createUser('Synthetic read-only teammate'); store.grantMember(creator.user.id, shared.id, readOnly.user.id, 'reader');
    const readOnlyContext = await browser.newContext(); const readOnlyPage = await readOnlyContext.newPage(); await readOnlyPage.goto(base + '/#token=' + readOnly.token);
    await expect(readOnlyPage.locator('#status')).toHaveText('Ready'); await expect(readOnlyPage.locator('#memories article')).toHaveCount(2);
    await expect(readOnlyPage.locator('#capture')).toBeHidden(); await expect(readOnlyPage.locator('#share')).toBeHidden(); await expect(readOnlyPage.locator('#download')).toBeVisible();
    await readOnlyContext.close();
    await page.locator('#logout').click(); await expect(page.locator('#signin')).toBeVisible();
    assert.deepEqual(errors, []); await recipient.close();
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); shares.close(); }
});
