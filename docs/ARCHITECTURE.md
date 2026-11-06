# Pensieve v0.2

## Data flow

Session JSONL / explicit capture → deterministic message chunks → private SQLite
store → provider-specific embeddings → cosine recall with source references.
Explicit ID selection → portable bundle → file / Git / authenticated workspace →
recipient’s private store → recipient’s own embeddings.

Implementation: [sessions](../src/sessions.ts), [store](../src/store.ts),
[providers](../src/embeddings.ts), [sharing](../src/sharing.ts).

## Decisions

- TypeScript CLI and HTTP server share one store implementation. Browser assets
  are plain HTML/CSS/JavaScript; there is no frontend build pipeline.
- SQLite keeps text and vectors on disk. Ranking is exhaustive cosine search;
  replace it with an ANN index when measured corpus size warrants it.
- Embedding identity includes provider and model. Changing the model creates a
  new index; dimensions are checked before persistence and search. If a model is
  replaced under the same name, use a new model name to avoid stale vectors.
- Transcript import is deliberately lossless within supported text blocks and
  fixed 2,400-character chunks. Summaries, fact extraction, and contradiction
  resolution are future work, not claimed behavior.
- Memory IDs include source content and provenance. Bundle IDs survive transport;
  content conflicts fail transactionally. Git merges are ordinary bundle-file
  merges, not a custom conflict-resolution system.
- Browser API requires a bearer token, checks Origin, and renders memory text with
  textContent. Private UI binds to loopback. Workspace sharing uses a separate
  persisted store mode and exposes only authenticated bundle exchange.

Sources: [CLI](../src/cli.ts), [store](../src/store.ts), [server](../src/server.ts),
[browser](../web/app.js), [sharing](../src/sharing.ts).

## Scope and next increments

Implemented: Codex/Claude JSONL import and single-file watching; explicit live
capture; local and opt-in cloud embeddings; CLI and local UI; portable bundles;
Git export; self-hosted shared-token exchange.

Executive sharing adds a separate snapshot store, invited email-code sign-in,
expiry/revocation, and a reader with source-backed Q&A. Local named pools and agent
shortcuts simplify opening, sharing, and downloading. The single owner configures
hosting once; recipient email delivery requires a configured sender. See
[executive sharing](EXECUTIVE-SHARING.md) and [access implementation](../src/executive.ts).

Not yet implemented: managed hosting, multi-owner accounts, invitation emails, fine-grained
permissions, automatic secret detection, automatic session hooks, MCP server,
semantic summaries, incremental byte-offset tailing, large-corpus ANN indexing,
deletion/retention, encrypted-at-rest storage, or browser UI for remote workspaces.
The HTTP services are small trusted-team prototypes, not a multi-tenant service.

See the [command surface](../src/cli.ts) and [tests](../test/core.test.ts) for the
implemented boundary. These gaps should become separate scoped issues.
