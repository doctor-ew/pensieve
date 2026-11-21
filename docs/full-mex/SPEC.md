# Shared repository knowledge in Pensieve

## Product intent (latest user clarification)

The user wants MEX-like repository knowledge in Pensieve's remote vector database, readable by authorized AI clients on Codex Cloud, either Mac, and other devices. Pensieve is the shared knowledge destination. A consumer must not require a local repository checkout, MEX installation, or access to the producer's filesystem.

Use pinned MEX 0.9.0-beta.1.1 to derive repository evidence. Publish bounded, searchable records through Pensieve's existing authorized memory and indexing paths. Preserve repository identity, source revision, file/line citations, and evidence quality. A graph artifact or successful extraction job alone does not satisfy remote vector retrieval.

Completion requires a producer to synchronize a selected repository into an explicitly selected pool, followed by successful semantic recall from an independent remote client. Indexing queued, indexing complete, and revision current are separate states. Replacement revisions must not silently leave superseded evidence presented as current; removed symbols must be handled too.

Rebuilding MEX's Hub, Inbox, Relays, Members, Specs, Workstreams, and statecharts is outside this clarified scope. The graph/notes prototype is supporting infrastructure, not the product completion criterion.

Approved: web, remote MCP and local agents; local uploads and connected Git repositories; automatic refresh for explicitly connected repositories.

## Acceptance criteria

1. Use a pinned real MEX runtime for graph extraction and relationships, rather than reproducing selected algorithms.
2. Persist repository ownership, source, revision, refresh configuration and job history under Pensieve pool authorization. Reader access never permits mutation.
3. Accept bounded local committed-source snapshots and connected Git sources. Authenticate private source access independently from Pensieve identity; never reuse an operator-wide credential for arbitrary user-selected repositories.
4. Build and refresh in an isolated producer process (Mac or CI). A hosted extraction worker is optional; remote readers do not depend on a running producer. Do not execute repository hooks, install scripts, plugins, or package commands. Explicitly bound files, bytes, time, output and concurrency.
5. Publish useful code definitions, relationships, and repository knowledge into Pensieve's remote searchable memory. Web, remote MCP, and local agents retrieve the same pool-scoped knowledge. Return source revision and evidence quality; stale evidence cannot appear current.
6. Preserve provenance and distinguish extracted facts from unverified notes. Do not automatically promote recalled repository content to agent instructions.
7. Remote retrieval works without local MEX or a repository checkout. Any producer-side watcher is opt-in per connected repository and preserves unrelated host configuration.
8. Automatic refresh only follows registered sources. Local watchers and remote source updates must coalesce repeated revisions and report failures without discarding the last successful artifact.
9. Updates publish atomically. Retries are idempotent; crashed or duplicate workers cannot publish over a newer version. Account/pool changes are rechecked at execution and retrieval.
10. Web and MCP expose publication status, indexed record counts, last successful revision and actionable recovery. No secrets or internal source paths appear in routine errors.
11. Existing memory functions and OAuth connection behavior remain compatible.
12. Validate real MEX extraction, remote vector indexing and recall, cross-pool isolation, revision replacement, removed symbols, malicious paths, duplicate jobs, and lost workers. Verify independent-client retrieval against the deployment before calling the integration complete.

## Current progress

- Completed: isolated branch, source inventory, pinned runtime, real graph/relationship adapter, isolated note lifecycle, bounded process execution, adapter tests.
- Prototyped, not deployed: durable repository/job/artifact storage, upload intake, repository worker and remote tools/routes.
- Implemented and tested locally: producer publication into vector memory, atomic active snapshots, revision citations, removed-symbol suppression, AWS vector pre-filtering, remote status, web connection/status interface, Git intake and opt-in producer watcher.
- Pending release validation: CI, AWS deployment, live Bedrock/S3-vector indexing and independent-client recall.
- Not provided by this release: an always-on hosted Git scheduler or hosted MEX graph jobs. A configured Mac/CI producer performs extraction and refresh; retrieval stays available when that producer is offline. Prototype graph-job endpoints are disabled in production.

No full integration is deployed yet. This tracker must retain outstanding items until they are implemented and verified.

## v0.8.5 source clarification

The user supplied https://github.com/mex-memory/mex/blob/v0.8.5/README.md during implementation. Its broader product workflows are background context, not requirements to reproduce the MEX product inside Pensieve.

Runtime baseline resolved: retain pinned 0.9.0-beta.1.1 following the user's direction. Git remains the source of repository code; Pensieve stores the shared derived knowledge. The latest clarification resolves the storage/product direction without further Hub or workflow choices. The earlier decisions (all three client surfaces, both source intake modes, automatic refresh for connected sources) remain approved. Prototype files are uncommitted and no full-integration changes have shipped.
