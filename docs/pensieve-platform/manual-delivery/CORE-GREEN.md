# Manual core implementation evidence

Manual takeover only. This does not change or certify the blocked Nightshift run.

Implemented after controller relayed adversarial specification clearance (A1–A6, including persisted opaque sourceServer issuer).

Command:

```sh
pnpm exec tsx --test test/core.test.ts test/sharing.test.ts test/unpack.test.ts test/team-store.test.ts test/policy.test.ts test/memory-record.test.ts
```

Actual result: exit 0; 42 tests, 42 pass, 0 fail, 0 skipped.

`pnpm exec tsc --noEmit`: exit 0 at this checkpoint. Other agents are actively implementing adjacent modules, so the final integrated check remains required.

The owned tests cover private pool reads/writes/index/search/export isolation, revoked tokens and in-flight revocation, writer/reader permissions, owner protection, atomic conflicting batch rollback, exact model/dimension/pool isolation, external backend foreign-ID filtering and retry after failed upsert, no partial local indexing after a bad later embedding batch, server-authored and downgraded imported provenance, share registry durability/ownership, exact policy keys, private/off precedence, malformed policy/TOML rejection, and optional metadata validation. All fixtures are synthetic; embedding providers and external vector backends here are deterministic doubles.

No live Azure or hosted app connection was exercised by this core suite. Parent integration owns real adapter contracts, MCP/HTTP/browser workflows, local unpack propagation, build and final review evidence.

## Follow-on portable local provenance and Azure adapter

New portable unpack test first failed with ENOENT for `.pensieve/provenance.jsonl` (2 existing tests passed, 1 new test failed). After implementation, local Store.add(memories, provenance), selected Store.bundle, CLI ingest/pull, legacy /api/bundle, and unpack preserve imported attribution as unverified-import. Unpack writes provenance.jsonl and explains its trust boundary. Tests cover repeated import deduplication, selection exclusion and conflict rollback.

Azure RED module-not-found evidence is appended in CORE-RED.md. AzureVectorBackend uses an existing explicitly configured Azure public HTTPS Search service/index with schema fields id (key), memoryId, poolId/model (filterable), vector (configured dimensions). It sends vectors and IDs only, checks each indexing receipt, escapes filter literals, rejects redirects, bounds requests with a timeout and validates model/dimensions. Stable document keys make partial-upsert retries idempotent; TeamStore commits local markers only after all remote batches succeed.

Latest command `pnpm exec tsx --test test/team-store.test.ts test/azure-vectors.test.ts test/unpack.test.ts`: exit 0, 19/19 pass. This includes owner-only pool-wide team defaults and personal repository overrides. Latest full typecheck found a concurrent, unrelated TS2742 at agent-server.ts createConnectorApp; controller notified. Earlier typecheck after portable/Azure changes passed. Final integrated verification remains controller-owned.

Azure tests are deterministic fetch/HTTP contract doubles through actual TeamStore, not a live Azure deployment. They exercise item-level 207 failure/retry, stable IDs, model/dimension mismatch, foreign pool ID filtering, escaped OData filters and failed/redirect responses.

Authoritative protocol references checked during implementation:
- https://learn.microsoft.com/en-us/rest/api/searchservice/documents/search-post?tabs=HTTP&view=rest-searchservice-2024-07-01
- https://learn.microsoft.com/en-us/rest/api/searchservice/documents/?view=rest-searchservice-2025-09-01
- https://learn.microsoft.com/en-us/azure/search/vector-search-filters

## Independent review repair checkpoint

TeamStore share listing/revocation now requires current writer/owner role, including when the actor originally created the share and was subsequently downgraded. Regression proves reader cannot list/revoke but can export, owner can still revoke.

External indexing chunks accumulated pools into at most10000 records per VectorBackend.upsert. All chunks must complete before any local receipts commit. Regression creates10001 records across legal contribution batches, fails last remote chunk, confirms no local index exists, retries both chunks, and commits10001 records. Owned team-store suite:15/15 pass. Integrated neighboring review suites:25/25 pass; typecheck passes. These repairs still require independent review; this evidence is implementation verification only.
