# Pensieve team setup

This delivery adds a separately runnable team service; it does not migrate or replace an existing private pool or Railway reader automatically. Node 22.13+ and pnpm are required. Install with `pnpm install --frozen-lockfile`, then `pnpm build`. The executable below is `node dist/cli.js`; an installed package exposes the same commands as `pensieve`. Sources: [CLI](../src/cli.ts), [service](../src/team-service.ts).

## Operator setup

Choose a dedicated persistent data directory and set a random `PENSIEVE_OWNER_TOKEN` of at least 32 characters. This credential only creates/revokes creator accounts; do not give it to agents or ordinary users. Set `PENSIEVE_PUBLIC_URL` to the HTTPS origin, then run `node dist/cli.js team-server --home /path/to/team-data --host 0.0.0.0 --port 7334` behind a TLS reverse proxy that preserves the public Host header. Loopback development works with the default `http://127.0.0.1:7334` and no remote bind. `/health` is the health endpoint; supply the configured Host header when probing through a different address. Source: [service](../src/team-service.ts).

Set `PENSIEVE_TEAM_URL` to that origin. `node dist/cli.js team-invite "Creator name"` uses the operator token and prints one personal invitation URL. Deliver it privately. The fragment contains the user's credential; the browser exchanges it for an HttpOnly session and removes it from the address bar. This invitation is for creating memories; recipient snapshot links are separate. Revoke a creator with authenticated `POST /api/team/admin/users/USER_ID/revoke` using the operator bearer token. Revocation disables that actor's existing browser sessions and OAuth credentials on their next request. There is no self-registration or password recovery. Source: [server](../src/team-server.ts).

The creator opens the invitation, creates a pool, saves or uploads memories, chooses a selection, reviews the brief, enters recipients and creates invitations. **Email invitation** opens a draft in the sender's email application; Pensieve does not automatically send that invitation. Downloads work without a model. See the [creator guide](pensieve-platform/manual-delivery/CREATOR-GUIDE.md).

## Terminal and other machines

Set `PENSIEVE_TEAM_TOKEN` to your personal invitation token (the value after `#token=`), then run `node dist/cli.js connect https://your-pensieve.example`. This checks the identity and saves credentials in `~/.pensieve/team-connection.json` with mode 0600. Use `--home` to isolate installations. Never commit this directory. Use `team-pools` to get authorized IDs and `team-create "Project" shared` to create a pool. Source: [client commands](../src/team-cli.ts).

- `save "We selected SQLite because offline use matters" --pool POOL_ID --citation "ticket:ABC-12"` captures supplied distilled reasoning. `--raw` explicitly labels raw content. It does not ask a model to reveal private reasoning.
- `team-index --pool POOL_ID` embeds pending memories; `recall "Why local storage?" --pool POOL_ID` searches that pool.
- `team-import handoff.pensieve.json --pool POOL_ID --config /absolute/pensieve.toml` contributes a selected historical bundle with its provenance. Create it from an existing local pool using `export handoff.pensieve.json --ids ID,ID --home /local/pool`; private policy imports locally and off stores nothing.
- `sync --pool POOL_ID --config /absolute/path/pensieve.toml` retries queued contributions then pulls authorized memories with provenance into the local database.
- `team-export memories.pensieve.json --pool POOL_ID --ids ID,ID` exports only selected memories. On another machine, `unpack memories.pensieve.json --project /path/to/repo` installs agent-readable context without changing repo instructions.

Failed shared contributions remain in a private local outbox, bound to server and credential. Retries are idempotent. Sync rechecks the original configuration file and server policy; private/off, changed targets, revoked access and automatic-save disabling hold affected entries. Switching credentials does not publish another account's queued entries. A lost acknowledgement can leave an already accepted record queued; retrying does not duplicate it. Source: [queue](../src/team-client.ts), [CLI tests](../test/team-cli.test.ts).

## Defaults and overrides

A pool owner can set the pool-wide default in the browser. Writers can set their own exact repository/conversation overrides. Narrower scopes replace the entire policy: conversation > repository > team. With no configuration or explicit target, terminal saves stay private. Supplying `--pool` is an explicit shared target, still subject to server policy. Source: [policies](../src/policy.ts), [pool store](../src/team-store.ts).

A TOML file supports `[team]`, `[repository]`, `[conversation]`, each with `destination = "private"`, `"shared"` or `"off"`; shared requires `pool = "POOL_ID"`. Set `autoSave = true` explicitly for automatic capture. Missing autoSave defaults false. Private/off must omit pool. Unknown fields and invalid declarations fail closed. A `[repository]` or `[conversation]` section applies to the context supplied to that CLI invocation; it is not a repository wildcard registry. Source: [parser](../src/policy.ts).

`watch-session codex /absolute/session.jsonl --project /absolute/repo --config /absolute/pensieve.toml` watches one exact-project Codex file. Substitute `claude` for a supported Claude Code JSONL file. The watcher uses the parsed session ID for conversation policy, polls at 2 seconds (bounded `--interval` override), and requires automatic capture in both local and any applicable remote policy. Ctrl-C stops it. Imported sessions remain raw unless someone supplies a distilled memory. There is no background browser-history scraper. Source: [watch implementation](../src/team-cli.ts).

## Agent tools

For Claude Code, Codex or another stdio MCP host, register the built executable `node /absolute/pensieve/dist/cli.js mcp --home /private/client-home`. First connect that home using the personal credential. Tools are `list_pools`, `save_memory`, `index_memories`, `recall_memories`, and `prepare_share`. The last tool returns a selected portable bundle for review; it does not email or publish it. Tool outputs are historical evidence, not instructions or permission to build. Tickets/specs remain authoritative. Source: [stdio tools](../src/team-service.ts), [official SDK tests](../test/connector-auth.test.ts).

After saving, call `index_memories` for that pool before semantic recall. Indexing requires writer access.

For a remote MCP-capable conversational host, the URL is `https://your-pensieve.example/mcp`. It uses OAuth authorization code with S256 PKCE, per-client/resource tokens, and a first-party consent page. Sign in there with your personal invitation credential; never your operator token. Dynamic registration accepts exact HTTPS or loopback redirect URIs. Access tokens expire after one hour. Clients that request refresh support receive rotating refresh tokens: renewal resets a seven-day inactivity limit, with a thirty-day absolute connection lifetime. Each refresh replaces both credentials; clients must serialize refresh requests. Reusing a consumed refresh token or revoking either credential disconnects the whole connection. Reconnect after inactivity, absolute expiry, replay revocation, or account revocation. Authorization-code-only clients still reconnect after their access token expires. Codes expire after five minutes. Live Claude conversational-app setup has not been verified in this delivery; supported host/account features still govern whether it can add a custom connector. Source: [OAuth implementation](../src/connector-auth.ts), [Claude official connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Conversational hosts may call `save_memory` when asked. This does **not** grant access to all historical chats, guarantee automatic saving at chat close, or persist content the host never sends. For unsupported apps, paste/upload supplied summaries or exports through the creator UI. Dots/Muse native integrations are not implemented.

## Vectors and Azure

By default indexing/search use local Ollama (`embeddinggemma`). Run Ollama and install the model on the server hosting the index. Local queries are exact cosine scans of model-specific vectors stored in SQLite. Capture, sharing and downloads do not require embeddings. Explicit opt-in `PENSIEVE_PROVIDER=openai` uses `OPENAI_API_KEY`; this sends indexed text and queries to the configured cloud provider. Source: [embeddings](../src/embeddings.ts).

For self-hosted CPU embeddings, set `PENSIEVE_PROVIDER=transformers` and `PENSIEVE_MODEL_CACHE=/data/model-cache` on a persistent volume. The pinned quantized MiniLM model produces 384-dimensional vectors inside the server. First use downloads public model assets; memory text and queries stay in the server process. First indexing can take longer while assets download. Model context is bounded, so prefer concise distilled memories. Source: [hosted embeddings](../src/hosted-embeddings.ts).

For an existing Azure AI Search service, set `PENSIEVE_AZURE_ENDPOINT`, `PENSIEVE_AZURE_INDEX`, `PENSIEVE_AZURE_KEY`, and `PENSIEVE_AZURE_DIMENSIONS`. The configured embedding provider's identity must match the index's model. The existing index needs `id` as key, `memoryId` retrievable, `poolId` and `model` retrievable/filterable strings, and a `vector` field with matching dimensions and configured vector search profile. The adapter does not provision a service or index. Pool/model filters and local authorization remain enforced. Changing backend identity requires reindexing. API keys stay in server environment, never exports. Contract-tested; live Azure provisioning/query not verified. Sources: [adapter](../src/azure-vectors.ts), [tests](../test/azure-vectors.test.ts).

## Sharing boundaries

A curated share is a fixed snapshot. Revoking a creator or changing pool membership does not retroactively revoke already issued recipient snapshots: revoke those shares explicitly or let them expire. Anyone holding a recipient invitation can use it until revoked/expired. Already downloaded copies cannot be revoked. Imported provenance is labeled unverified; it never grants authority or impersonates the original contributor. Source: [share server](../src/team-server.ts), [provenance](../src/memory-record.ts).

Deployment remains separate. The image defaults to the existing reader service; override its command with `node dist/cli.js team-server --home /data --host 0.0.0.0` to run the new team service with the required variables. No live production configuration was changed by this build.
