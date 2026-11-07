# Independent core and Azure security review

Reviewer: manual_spec_review (implemented connector-auth/agent-server, but did **not** implement the reviewed team-store, Azure adapter, or root service wiring).

Scope: src/team-store.ts, src/azure-vectors.ts, src/memory-record.ts, and final src/team-service.ts integration. Manual delivery only; no Nightshift gate or deployment certification.

## Findings and final dispositions

### HIGH — Former writer retained share-revocation authority after downgrade — FIXED

Original evidence: TeamStore.authorizeShareRevocation accepted a matching creator without requiring current writer/owner role; listShares similarly exposed creator management after downgrade. The reviewer executed a synthetic owner -> writer grant -> writer-created share -> reader downgrade sequence and confirmed revocation authorization still succeeded. This contradicted the reader non-mutation contract.

Current correction: src/team-store.ts:140-146 now calls writable before both listing hosted share management and authorizing revocation. Owner-all and writer-own checks remain. Readers retain authorized memory export without hosted invitation management.

Retest: test/team-store.test.ts:220 tests the precise downgrade sequence, rejects former writer list/revoke, permits owner revocation, and preserves reader export. Passed in the reviewer's targeted run.

### MEDIUM — More than 10,000 accumulated unindexed memories could never index through Azure — FIXED

Original evidence: TeamStore.index supplied every pending record in one backend call, while AzureVectorBackend.upsert rejects records.length > 10,000. Multiple permitted contribution batches can exceed that ceiling.

Current correction: src/team-store.ts:181-187 chunks backend calls at 10,000, rechecks current authorization before and after each awaited upload, and only commits local indexed markers after all chunks succeed. Azure performs its own smaller HTTP upload batches internally.

Retest: test/team-store.test.ts:233 creates 10,001 records, injects failure in the final chunk, verifies no partial local search/index completion, then retries and indexes all records. Passed in the reviewer's targeted run.

### MEDIUM — Stdio save omitted synthetic metadata supported by HTTP tools — FIXED

Original evidence: remoteAgentServer's save schema and generated memory omitted synthetic, while the HTTP MCP interface preserved it. This could silently lose an explicit synthetic label during a terminal handoff.

Current correction: src/team-service.ts:21-23 accepts/persists optional synthetic without changing false into absence. The reviewer extended the existing actual CLI subprocess test to supply synthetic:true and assert the persisted remote memory retains it. That focused retest passed.

## Additional reviewed boundaries

- Core pool reads/mutations derive an authenticated actor; memberships are checked before source access and rechecked after asynchronous embedding/backend work. Immutable contribution conflicts roll back batches.
- Imported provenance is validated, associated only with included memory IDs, retained separately, and marked unverified-import. Authenticated server contribution attribution is generated from the actual actor.
- Azure endpoint validation restricts the destination to Azure AI Search HTTPS origins. Redirects are rejected; errors do not echo credentials or provider bodies. Model/dimension validation precedes requests. Pool/model filters are composed by trusted code with quoted literals escaped.
- Azure per-item upsert acknowledgments are checked against the expected document keys. Remote results are filtered through the authorized local pool/model index before content is returned; a remote backend cannot inject a foreign memory body.
- Root service wiring constructs one TeamStore with the selected VectorBackend, passes that same store to creator and connector surfaces, limits connector delegation to known paths, and connects terminal tools through a personal TeamClient rather than the operator key. The operator credential is used for invitation/bootstrap administration.
- Root's stdio protocol is exercised through actual `node --import tsx src/cli.ts mcp` subprocesses with separate synthetic creator credentials and a temporary team server. Tests verify cross-account isolation, save, semantic recall, source metadata preservation, and revocation.

## Verification performed by this reviewer

`pnpm exec tsx --test test/team-store.test.ts test/azure-vectors.test.ts test/connector-auth.test.ts`

Result: **24 tests passed, 0 failed**. These cover both reported core regressions, adapter-through-TeamStore integration and existing authorization/provenance boundaries, plus real OAuth/official SDK HTTP and stdio integration.

After adding the explicit synthetic assertion:

`pnpm exec tsx --test --test-name-pattern='CLI mcp subprocess' test/connector-auth.test.ts`

Result: **1 focused test passed, 0 failed**.

## Disposition

**No remaining blockers found within this reviewed core/Azure/root-wiring scope.** This is a bounded review, not a guarantee of absence of defects. The reviewer does not independently approve their own connector implementation; that code requires the separate controller/core reviewer. Azure tests use deterministic HTTP doubles, not a live Azure deployment. No signed-in Claude application handshake was performed. Full repository/build/browser evidence and publication status belong in the controller's final evidence artifacts.
