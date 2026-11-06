// Synthetic-only browser fixture. Never use this mailer in a deployed service.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.js';
import { ShareStore } from '../src/executive.js';
import { createApp } from '../src/server.js';
import { createShareServer } from '../src/share-server.js';
import { saveSettings } from '../src/pools.js';
import { makeMemory } from '../src/sessions.js';

const home = await mkdtemp(join(tmpdir(), 'pensieve-sharing-browser-'));
process.env.PENSIEVE_CONFIG_HOME = home;
const ownerToken = randomBytes(32).toString('hex');
saveSettings({ pools: [], shareService: 'http://127.0.0.1:7445', shareToken: ownerToken });
const store = new Store(join(home, 'memory.sqlite'));
store.add(['Synthetic: We chose SQLite to keep the database local.', 'Synthetic: Unselected confidential garden plans.'].map(text => makeMemory({ text, source: 'manual', session: 'synthetic', role: 'user', timestamp: '', locator: 'test fixture', project: '' })));
const shares = new ShareStore(join(home, 'shares.sqlite'));
const reader = createShareServer(shares, { ownerToken, publicUrl: 'http://127.0.0.1:7445', mailer: { sendCode: async (email, code) => { await writeFile(join(home, 'test-mail.json'), JSON.stringify({ email, code }), { mode: 0o600 }); } } });
const owner = createApp(store, { identity: 'synthetic-only', embed: async texts => texts.map(() => [1, 0]) }, { poolName: 'Synthetic board briefing' });
reader.listen(7445, '127.0.0.1'); owner.server.listen(7444, '127.0.0.1');
process.stdout.write(JSON.stringify({ home, owner: `http://127.0.0.1:7444/#${owner.token}` }) + '\n');
const stop = () => { reader.close(); owner.server.close(); store.close(); shares.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
