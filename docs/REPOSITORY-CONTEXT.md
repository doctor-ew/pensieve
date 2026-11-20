# Repository context in Pensieve

Pensieve can index a local Git repository, search its committed TypeScript and JavaScript symbols, and publish explicitly selected code snapshots to an authorized memory pool. Decisions can cite the returned `pensieve-code://` references through the existing memory `citations` field. Published code is retrieved through `recall_memories` after semantic indexing finishes.

## Use

- Run `pensieve repo-index /path/to/repository --home /private/client-home`. Add `--pool ID` to attach the repository to a destination pool. Indexing performs no upload or model call.
- Run `pensieve repo-list --home /private/client-home` to get repository IDs, indexed commits, freshness, and whether tracked files have uncommitted edits.
- Run `pensieve repo-search "authenticate" --repo ID --home /private/client-home` to review symbols, source excerpts, hashes, and citations.
- Run `pensieve repo-publish ID --pool POOL_ID --ids SYMBOL_ID --home /private/client-home` only after reviewing the selected source. The destination uses the same saved connection and server capture policy as other Pensieve contributions. The receipt identifies the server, pool, commit, memory IDs, and indexing state.
- In the local browser UI, use **Repositories** to index and search. **Load my Pensieve pools** uses the configured personal connection. Select code, choose a pool, and press **Publish selected code**. This publishes to pool members; indexing and searching alone stay local.

Commands are defined in [code-cli.ts](../src/code-cli.ts) and [cli.ts](../src/cli.ts). The local browser routes are in [server.ts](../src/server.ts).

## Agent tools

The local stdio MCP server adds `list_repositories` and `search_code`. These read snapshots from its `--home`, even when the cloud connection is unavailable. They do not accept arbitrary file paths, index repositories, or upload source. Remote conversational connectors retrieve explicitly published snapshots through the existing authorized memory tools; they cannot read the workstation. See [team-service.ts](../src/team-service.ts).

## Snapshot boundaries

- The first slice supports TS, TSX, JS, JSX, MTS, CTS, MJS, and CJS. It extracts declarations and nested symbols, not a resolved call graph or dependency graph.
- Only regular source-file blobs in a pinned Git commit are read. Symlinks, submodules, hidden paths, dependency/build/vendor directories, declaration files, non-source files, and uncommitted changes are excluded. No project code, compiler plugins, package scripts, or hooks are executed.
- Limits are 2,000 source files, 500 KB per file, 20 MB total source, and 20,000 symbols. Excerpts are capped at 6,000 characters and explicitly marked when truncated.
- Reindexing replaces the local snapshot transactionally. Search results identify the indexed commit and distinguish a changed HEAD from uncommitted edits. Published snapshots remain historical evidence; reindexing does not remove previously published memories.
- Code selection is limited to 100 symbols per publication. Uploads use batches of 16 and content-derived IDs, so retrying a partially completed publication does not duplicate unchanged snapshots. An indexing failure is reported separately from successful publication.
- Publishing includes repository name, relative paths, commit, hashes, and selected source. It does not include the absolute checkout path or Git remote URL. Review committed source before sharing it.

These behaviors are implemented in [code-context.ts](../src/code-context.ts) and exercised by [code-context.test.ts](../test/code-context.test.ts).

## MEX reuse

The stable symbol identity algorithm is adapted from MEX commit `e5d4b93c84f09b946edc890859c7479700c2ee52`. Line shifts do not change an ID; moves, renames, and changes among duplicate declarations can. Pensieve owns the TypeScript AST extraction, local storage, publishing adapter, and UI. This first slice does not bundle MEX's full graph engine, hook installer, or configuration system. The original MIT notice is retained in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Agent authentication recovery

The accompanying local client fix distinguishes HTTP 401 from a generic tool failure and reloads the saved connection before each tool call. It does not mint credentials, weaken server authentication, or restore an invalid credential. Reconnect using a valid personal credential and the same `--home`; environment overrides still take precedence. See [TEAM-SETUP.md](TEAM-SETUP.md#recover-a-terminal-agent-connection).
