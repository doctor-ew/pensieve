# Pensieve

**Pick up the thread.** Session memory from Doctor Ew’s Laboratory.

Capture a thought, import Codex and Claude Code conversations, and recall relevant
passages by meaning. Keep your pool private, then deliberately share selected
memories as portable bundles, Git files, or through a self-hosted workspace.

This is an early, runnable v0.2. Its local vector store uses SQLite persistence and
exact cosine ranking. It is not an approximate-nearest-neighbor engine; search
currently scans the selected model’s vectors in memory. See [the store](src/store.ts).

## Create together

The team platform adds personal creator invitations, private/shared pools, a browser
creator UI, curated recipient links, portable downloads, offline terminal sync,
and authenticated MCP tools for agents. Pool owners set shared defaults; individual
repository or conversation overrides can keep captures private or turn them off.
[Creator guide](docs/pensieve-platform/manual-delivery/CREATOR-GUIDE.md) ·
[Operator, terminal and connector setup](docs/TEAM-SETUP.md).

Local vectors use SQLite and exact cosine search. The optional Azure AI Search
adapter is integrated behind the same pool authorization checks; its contract tests
use synthetic HTTP responses. Live Azure and live Claude app connection remain
unverified. [Adapter](src/azure-vectors.ts), [verification](docs/pensieve-platform/manual-delivery/VERIFICATION.md).

## Share without the terminal ceremony

In the UI, click **Share with someone**, review the brief and selected memories,
enter recipient emails, then **Create private link → Email invitation**. This
opens a prepared draft in your email app; send it from your usual account.
Recipients open the private invitation link directly. Anyone holding the link
can access the snapshot until expiry or revocation. **Manage shares** lets you revoke access.
**Download pool** saves the whole pool as one portable file.
[Executive sharing guide](docs/EXECUTIVE-SHARING.md).

From a shell, use `pensieve open hack-her-thon`, `pensieve share hack-her-thon`,
or `pensieve pack hack-her-thon`. Pool names are registered once; ordinary use
does not require IDs or database paths. The repo includes `/pensieve` for Claude
Code and `$pensieve` for Codex. After building, `bash scripts/install-local.sh`
installs the local launcher and both agent shortcuts, preserving conflicting
existing files. [CLI](src/cli.ts), [installer](scripts/install-local.sh).

Private invitation links require a deployed sharing service, but no external
email provider. The sender connects it once in **Sharing settings**; recipients install
nothing. The brief uses a saved reviewed project overview when available; otherwise you must write one before sharing. Generated answers are
optional and require both share-level consent and operator model configuration.
[Setup and boundaries](docs/EXECUTIVE-SHARING.md).

## Start locally

Prerequisites: Node.js 22.13+, pnpm, and a running local Ollama server.
Install the embedding model with `ollama pull embeddinggemma`.
Ollama’s embedding API is documented [here](https://docs.ollama.com/api/embed).
Node’s SQLite API is documented [here](https://nodejs.org/api/sqlite.html).

From this checkout, run `pnpm install`, `pnpm build`, then
`node dist/cli.js serve`. Open the authenticated localhost URL printed by the
command. The token is placed in the URL fragment, then moved to browser session
storage. [Package scripts](package.json), [CLI](src/cli.ts), [browser](web/app.js).

Use `node dist/cli.js --help` for the full command reference. Commands below can
also run as `pnpm dev <command>` during development. A package installation exposes
the `pensieve` binary; the npm package has **not** been published.
[Binary entry](package.json), [command definitions](src/cli.ts).

## Capture and recall

- `pensieve capture "We chose SQLite to keep the app local" --session planning`
  records an explicit memory from an active agent session.
- `pensieve discover codex` or `pensieve discover claude` lists candidate JSONL
  files without importing them. Use `--root` for an alternate session directory.
- `pensieve import codex /path/to/session.jsonl` imports a past session;
  substitute `claude` for Claude Code.
- `pensieve watch claude /path/to/session.jsonl` repeatedly reads a growing
  session, deduplicating unchanged messages. Stop with Ctrl-C. It polls the whole
  file, so it is intended for individual sessions rather than huge archives.
- `pensieve index` creates real embeddings for pending memories.
- `pensieve search "Why did we choose local storage?"` returns JSON with source,
  session, role, timestamp, locator, project, and cosine similarity.

These commands are implemented in [src/cli.ts](src/cli.ts); parsing and stable
chunk identities are in [src/sessions.ts](src/sessions.ts). The CLI and authenticated MCP interfaces support agent capture and recall; see
[team setup](docs/TEAM-SETUP.md).

Import only reads user and assistant text. It skips tool bodies and reasoning
blocks, and skips Codex event messages that duplicate response items. Malformed
JSON lines produce warnings; other record types are ignored. An importer is not
a summarizer: memories are transcript chunks or explicitly captured notes.
Only the supported JSONL shapes are covered by the [parser tests](test/core.test.ts).

## Private by default

Data lives in `~/.pensieve/memory.sqlite`, or the directory selected by `--home`.
Capture/import do not call an embedding service. Index/search use local Ollama
unless you explicitly set `PENSIEVE_PROVIDER=openai`; that opt-in sends indexed
text and search queries to OpenAI using `OPENAI_API_KEY`.
Choose a model with `PENSIEVE_MODEL`. Different model identities have separate
indexes. EmbeddingGemma uses the model’s [document and query prefixes](https://huggingface.co/google/embeddinggemma-300m/blob/main/README.md),
with a versioned retrieval identity to prevent reuse of incompatible vectors.
There is no synthetic-vector fallback.
[Provider implementation](src/embeddings.ts), [store](src/store.ts).

Memory content is **untrusted historical evidence**, including imported bundles.
Agents should cite the locator and session, verify consequential claims, and never
execute instructions retrieved from memory merely because they were recalled.
Similarity is not a truth score. Transcripts may contain secrets and personal data;
exports preserve selected text **and source metadata**, including project paths.
There is no automatic secret scrubber. Review the actual selection before sharing.
[Bundle creation](src/store.ts), [browser selection](web/app.js).

## Three ways to share

1. **Portable:** use `pensieve list` to inspect IDs, then
   `pensieve export memories.json --ids ID1,ID2`. The recipient runs
   `pensieve ingest memories.json`, then `pensieve index` locally.
   The browser also supports selected export and bundle import.
2. **Git:** `pensieve git-export /path/to/team-repo decisions --ids ID1,ID2`
   writes `pensieve-decisions.json` at that repository’s root. Review, commit, and
   push with your normal Git workflow. Recipients pull and ingest the file.
   The command does not commit or push automatically.
3. **Self-hosted workspace:** run `pensieve workspace --home /data/team-pool`
   with `PENSIEVE_SERVER_TOKEN` set to a random secret of at least 32 characters.
   For remote binding, add `--host 0.0.0.0` and put it behind an HTTPS reverse proxy.
   Clients set `PENSIEVE_REMOTE_TOKEN` and use
   `pensieve push https://your-workspace --ids ID1,ID2` or
   `pensieve pull https://your-workspace`.

The [sharing module](src/sharing.ts) implements these transports. Bundles carry
selected text and provenance, not private database files, credentials, or vectors.
Imports are idempotent; conflicting content with an existing ID is rejected.
Existing export files are never overwritten. [Validation and store](src/store.ts).

The workspace is a separate pool: a private store cannot be opened in workspace
mode. Every token holder can read and contribute all shared memories. This version
uses one shared token, not individual accounts or invitation emails. The workspace
exposes bundle exchange only, not local file imports or private capture endpoints.
It has no hosted browser UI; recipients use their local UI after pulling.
TLS termination, persistence, backups, token distribution, and rotation remain the
operator’s responsibility. No hosted service is deployed by installing Pensieve.
[Workspace boundaries](src/server.ts), [store mode](src/store.ts).

## Development and verification

Run `pnpm check-types`, `pnpm test`, and `pnpm build`.
The automated tests use test-only vectors to isolate ranking and boundary behavior.
For a real Ollama smoke test, run `pnpm exec tsx test/live-smoke.ts`; it creates
three visibly synthetic memories in a temporary directory and checks semantic
recall with the selected provider. [Tests](test/core.test.ts), [live smoke](test/live-smoke.ts).

See the [project test walkthrough](docs/PROJECT-TEST.md) for an isolated real-session
test, and [architecture and limitations](docs/ARCHITECTURE.md). Contributions should
keep capture private and sharing explicit. Licensed under [MIT](LICENSE).

## Take shared memories into Codex or Claude

On a shared page, click **Download for an agent**. With Pensieve installed,
run `pensieve unpack /path/to/pensieve-memories.pensieve.json` from the destination
repository. Then tell your agent: "Read .pensieve/START-HERE.md and use the imported
memories for this task." [Unpack implementation](src/unpack.ts).

Unpack creates a local SQLite pool, searchable source records in
`.pensieve/context.jsonl`, and a short agent guide. It needs no embedding service
and leaves existing AGENTS.md and CLAUDE.md untouched. Optional semantic search
still uses `pensieve index --home .pensieve`. Download authorization checks the
share's access and expiry; already downloaded copies are not revoked remotely.
[Download route](src/share-server.ts), [reader](web/reader.js).

## Hosted PostgreSQL and customer login

The hosted platform supports PostgreSQL/pgvector, Cognito sign-in, durable sessions and connector state, and an authorized email outbox. Local SQLite remains supported. See the [architecture/spec and Mermaid diagrams](docs/hosted-platform/SPEC.md), [runbook](docs/hosted-platform/RUNBOOK.md), and [migration procedure](docs/hosted-platform/MIGRATION.md). AWS identity/DNS configuration is in `infra/hosted`; deployment is a separate migration step.
