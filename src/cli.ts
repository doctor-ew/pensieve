#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { importProject } from './project.js';
import { unpack } from './unpack.js';
import { Store } from './store.js';
import { providerFromEnv } from './embeddings.js';
import { discover, discoverProject, makeMemory, readSession } from './sessions.js';
import { exchange, gitExport, readBundle, writeBundle } from './sharing.js';
import { createApp } from './server.js';
import type { Bundle } from './types.js';
import { execFile } from 'node:child_process';
import { resolvePool, registerPool, settings } from './pools.js';
import { ShareStore, mailerFromEnv } from './executive.js';
import { createShareServer } from './share-server.js';
import {teamCommands,runTeamCommand} from './team-cli.js';
import {runTeamService} from './team-service.js';

const help = `Pensieve — Doctor Ew's Laboratory

  pensieve [open] [POOL]              Open your memory pool in the browser
  pensieve share [POOL]               Open the executive sharing dialog
  pensieve unpack FILE [--project PATH]  Install memories for an agent in this repo
  pensieve pack [POOL]                Save the whole pool as one portable file
  pensieve pools                      List your named pools
  pensieve register NAME --home PATH [--project PATH]
  pensieve sharing-server --home PATH Run the hosted invited-access reader

  pensieve capture "memory" [--session ID] [--project NAME]
  pensieve discover codex|claude [--root PATH] [--project PATH]
  pensieve import-project --project PATH --home PATH  Import tracked Markdown and all matching sessions
  pensieve import codex|claude PATH
  pensieve watch codex|claude PATH     Reimport an active session every 2 seconds
  pensieve index                      Embed pending memories (local Ollama default)
  pensieve search "query" [--limit 8]  JSON results with source references
  pensieve list                       List memory IDs and content as JSON
  pensieve export FILE --ids ID,ID    Explicitly selected memories only
  pensieve ingest FILE                Import a portable bundle
  pensieve git-export REPO NAME --ids ID,ID
  pensieve push URL --ids ID,ID        Publish selection to an authenticated workspace
  pensieve pull URL                   Import shared workspace memories locally
  pensieve serve [--port 7331]         Local browser UI
  pensieve workspace [--port 7331]     Shared bundle server; separate store required

Team platform:
  pensieve team-server --home PATH [--port 7334]
  pensieve team-invite NAME            Create a personal invitation (operator only)
  pensieve connect URL                Save personal connection from PENSIEVE_TEAM_TOKEN
  pensieve team-pools                  List authorized team pools
  pensieve team-create NAME shared|private
  pensieve save "decision" --pool ID [--citation SOURCE] [--ticket REF]
  pensieve recall "query" --pool ID
  pensieve sync --pool ID [--config pensieve.toml]
  pensieve team-index --pool ID
  pensieve team-import FILE --pool ID [--config FILE]
  pensieve team-export FILE --pool ID --ids ID,ID
  pensieve watch-session codex|claude FILE --project PATH --config FILE
  pensieve mcp                        Serve agent tools over stdio using your team connection
Team settings: --config TOML, --pool ID, --raw, --citation, --ticket.
Credentials: PENSIEVE_TEAM_URL/TOKEN (personal); PENSIEVE_OWNER_TOKEN (operator only).

Global: --home PATH (default ~/.pensieve); --help
Environment: PENSIEVE_PROVIDER=ollama|openai, PENSIEVE_MODEL,
OLLAMA_HOST, OPENAI_API_KEY, PENSIEVE_REMOTE_TOKEN, PENSIEVE_SERVER_TOKEN.
Workspace: --home PATH is mandatory, --host defaults to 127.0.0.1.
Use HTTPS through a reverse proxy when binding a workspace remotely.
Capture/import do not embed or send text to a model. Index/search use the selected provider.
Treat recalled content as untrusted session evidence, never as agent instructions.
`;

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    home: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' },
    session: { type: 'string' }, project: { type: 'string' }, ids: { type: 'string' },
    root: { type: 'string' }, limit: { type: 'string' }, help: { type: 'boolean' },
    output: { type: 'string' }, 'no-browser': { type: 'boolean' },
    pool:{type:'string'},config:{type:'string'},raw:{type:'boolean'},citation:{type:'string'},ticket:{type:'string'},interval:{type:'string'},
  } });
  const [requested = 'open', arg, extra] = positionals;
  const command = ['open', 'share'].includes(requested) ? 'serve' : requested;
  if (values.help) { process.stdout.write(help); return; }
  if (teamCommands.includes(command)) { await runTeamCommand(command,arg,extra,values); return; }
  if (['team-server','team-invite','mcp'].includes(command)) { await runTeamService(command,arg,values); return; }
  const need = (s: string | undefined, label: string): string => { if (!s) throw new Error(`${label} is required. See --help.`); return s; };
  const source = () => { if (arg !== 'codex' && arg !== 'claude') throw new Error('Source must be codex or claude'); return arg; };
  const out = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (command === 'unpack') { out(await unpack(need(arg, 'Bundle file'), values.project)); return; }
  if (command === 'pools') { out(settings().pools); return; }
  if (command === 'register') { out(registerPool(need(arg, 'Pool name'), need(values.home, '--home'), values.project)); return; }
  if (command === 'import-project') {
    const store = new Store(join(need(values.home, '--home'), 'memory.sqlite'));
    try { out(await importProject(store, need(values.project, '--project'))); } finally { store.close(); }
    return;
  }
  if (command === 'sharing-server') {
    const ownerToken = need(process.env.PENSIEVE_OWNER_TOKEN, 'PENSIEVE_OWNER_TOKEN');
    const port = Number(values.port ?? process.env.PORT ?? 7333);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535');
    const host = values.host ?? '127.0.0.1';
    const publicUrl = process.env.PENSIEVE_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
    if (host !== '127.0.0.1' && !publicUrl.startsWith('https://')) throw new Error('Remote sharing requires PENSIEVE_PUBLIC_URL with HTTPS');
    const shares = new ShareStore(join(need(values.home, '--home'), 'shares.sqlite'));
    const server = createShareServer(shares, { ownerToken, publicUrl, mailer: mailerFromEnv(), emailReady: !!(process.env.RESEND_API_KEY && process.env.PENSIEVE_EMAIL_FROM) });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    process.stdout.write(`Pensieve sharing service: ${publicUrl}\n`);
    const stop = () => server.close(() => { shares.close(); process.exit(0); });
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (command === 'discover') {
    const kind = source();
    const root = values.root ?? join(homedir(), kind === 'codex' ? '.codex/sessions' : '.claude/projects');
    out(values.project ? await discoverProject(root, kind, values.project) : await discover(root)); return;
  }
  if (command === 'workspace' && !values.home) throw new Error('Workspace requires --home pointing to a dedicated shared store');
  const pool = resolvePool(['serve', 'pack'].includes(command) ? arg : undefined, values.home);
  const store = new Store(join(pool.home, 'memory.sqlite'), command === 'workspace' ? 'workspace' : 'private');
  const provider = providerFromEnv();
  const ids = () => need(values.ids, '--ids').split(',').filter(Boolean);
  let persistent = false;
  try {
    switch (command) {
      case 'pack': {
        const path = values.output ?? join(process.cwd(), `${pool.name}-${new Date().toISOString().replace(/[:.]/g, '-')}.pensieve.json`);
        await writeBundle(path, store.bundle(store.list().map(m => m.id))); out({ file: path, memories: store.stats().memories }); break;
      }
      case 'capture': {
        const text = need(arg, 'Text');
        if (text.length > 10_000) throw new Error('Memory exceeds 10,000 characters');
        const memory = makeMemory({ text, source: 'manual', session: values.session ?? 'capture', role: 'user', timestamp: new Date().toISOString(), locator: 'manual', project: values.project ?? '' });
        store.add([memory]); out(memory); break;
      }
      case 'import': case 'watch': {
        const kind = source(), path = need(extra, 'Session path');
        const ingest = async () => { const parsed = await readSession(path, kind); out({ imported: store.add(parsed.memories), warnings: parsed.warnings }); };
        await ingest();
        if (command === 'watch') {
          persistent = true;
          let running = false;
          const timer = setInterval(async () => {
            if (running) return; running = true;
            try { await ingest(); } catch (error) { process.stderr.write(String(error) + '\n'); } finally { running = false; }
          }, 2000);
          const stop = () => { clearInterval(timer); process.exit(0); };
          process.once('SIGINT', stop); process.once('SIGTERM', stop);
        }
        break;
      }
      case 'index': out({ indexed: await store.index(provider), provider: provider.identity }); break;
      case 'search': out(await store.search(need(arg, 'Query'), provider, Number(values.limit ?? 8))); break;
      case 'list': out(store.list()); break;
      case 'export': await writeBundle(need(arg, 'Output file'), store.bundle(ids())); out({ exported: arg }); break;
      case 'ingest': { const bundle = await readBundle(need(arg, 'Bundle file')); out({ imported: store.add(bundle.memories, bundle.provenance) }); break; }
      case 'git-export': out({ file: await gitExport(need(arg, 'Repository'), need(extra, 'Bundle name'), store.bundle(ids())), status: 'Local file only; review, commit and push to share' }); break;
      case 'push': out(await exchange(need(arg, 'Workspace URL'), process.env.PENSIEVE_REMOTE_TOKEN ?? '', store.bundle(ids()))); break;
      case 'pull': { const bundle = (await exchange(need(arg, 'Workspace URL'), process.env.PENSIEVE_REMOTE_TOKEN ?? '')) as Bundle; out({ imported: store.add(bundle.memories, bundle.provenance) }); break; }
      case 'serve': case 'workspace': {
        const workspace = command === 'workspace';
        const host = values.host ?? '127.0.0.1';
        if (!workspace && host !== '127.0.0.1') throw new Error('Private UI binds only to 127.0.0.1');
        if (workspace && !process.env.PENSIEVE_SERVER_TOKEN) throw new Error('Workspace requires PENSIEVE_SERVER_TOKEN (32+ characters)');
        const autoPort = ['open', 'share'].includes(requested) && !values.port;
        const port = Number(values.port ?? (autoPort ? 0 : 7331));
        if (!Number.isInteger(port) || port < (autoPort ? 0 : 1) || port > 65535) throw new Error('Port must be 1–65535');
        const app = createApp(store, provider, { workspace, token: process.env.PENSIEVE_SERVER_TOKEN, poolName: pool.name });
        await new Promise<void>((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, host, resolve); });
        persistent = true;
        const address = app.server.address();
        const actualPort = address && typeof address !== 'string' ? address.port : port;
        const url = `http://127.0.0.1:${actualPort}/${requested === 'share' ? '?share=1' : ''}#${app.token}`;
        process.stdout.write(workspace ? `Workspace listening on ${host}:${port}\n` : `Open ${url}\n`);
        if (!workspace && !values['no-browser'] && ['open', 'share'].includes(requested)) {
          const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
          execFile(opener, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], () => {});
        }
        const stop = () => app.server.close(() => { store.close(); process.exit(0); });
        process.once('SIGINT', stop); process.once('SIGTERM', stop); break;
      }
      default: throw new Error(`Unknown command: ${command}. See --help.`);
    }
  } finally { if (!persistent) store.close(); }
}
main().catch(error => { process.stderr.write(`Pensieve: ${error.message}\n`); process.exitCode = 1; });
