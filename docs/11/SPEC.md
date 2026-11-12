# Task 11: rotating OAuth refresh tokens for connectors

## Status

The user authorized ticket, specification and end-to-end build. Local implementation and validation are complete; targeted independent source re-review approved. Production deployment is outside scope.

## Problem and scope

The connector currently accepts `refresh_token` in registration input but stores `authorization_code` as the only grant, issues one-hour access tokens without refresh tokens, and rejects refresh exchange. The public OAuth metadata also advertises only authorization-code support. [S1, S2] This task adds refresh support only for clients that request it at registration and preserves authorization-code-only clients, PKCE, exact redirect and resource binding, and consent protection.

## Requirements and design

1. Registration preserves the client's supported grant selection. Accept only public clients using the existing authorization-code flow; advertise `refresh_token` for a registered client only when it requested refresh support. Server metadata advertises both implemented grants after the feature is complete. An authorization-code-only client receives no refresh credential. Keep access-token lifetime at 3,600 seconds, capped by the family’s absolute expiry when less than one hour remains. [S1, S2]
2. Successful code exchange for a refresh-enabled client creates a durable connection or family record and returns an opaque, high-entropy refresh token. Persist its digest, never the bearer value. Bind the family to actor, client ID, resource URL, authorized scopes, creation time, absolute expiry, current refresh digest, and revocation state. Set absolute expiry to 30 days after initial connection; set refresh inactivity expiry to seven days after each successful rotation, capped by absolute expiry. A refresh request at either deadline is expired.
3. Renewal validates the token, registered client, original resource, actor liveness, and currently authorized pool access. Requested scopes must be a subset of the current refresh grant’s scopes; omission retains that set. Narrowing persists through later rotations. With the existing single memories scope, an explicitly empty subset yields a token without memories permission and cannot authorize MCP tools. Resource omission retains the original resource; explicit mismatch returns invalid_grant. Scope expansion returns invalid_scope. Never broaden scopes or switch actor, client, or resource. Current pool permissions are checked when each connector operation runs, so removal of membership denies access even while a bearer token exists. [S3]
4. Every successful renewal atomically consumes the current refresh digest, records it as consumed through family expiry, writes a replacement digest, issues a new access-token digest, updates the family inactivity deadline, and invalidates the prior access token. The response contains only newly issued bearer credentials. A transaction failure leaves the old pair and family state intact. With overlapping initial reads and no injected storage failure, concurrent renewal produces exactly one successful response and one invalid_grant response. The losing request is replay: it returns invalid_grant and revokes the family, so even the winner’s returned tokens are unusable after both requests complete. Clients must serialize refresh requests; no replay grace window is introduced.
5. Presenting a consumed digest for its own client revokes the entire family, including all access tokens. An unknown digest or a digest presented by another client returns the protocol's non-disclosing failure and does not revoke another family. Keep consumed digests through absolute family expiry for replay detection. Disconnect or revocation of a current access or refresh token revokes the family. Renewal and revocation serialize on the same family state; a completed revocation cannot be undone by a racing renewal.
6. The shared authentication layer owns the lifecycle rules and protocol errors. Persistence adapters implement explicit atomic contracts for initial issuance, rotation, replay-family revocation, and disconnect. Use a family record and a digest-to-family lookup; avoid scanning the family's token history. A renewal or revocation uses a constant number of indexed reads and writes independent of rotation count. SQLite uses a write transaction, PostgreSQL uses row locking in a transaction, and DynamoDB uses conditional transactional writes. Bound DynamoDB transaction size independently of family age.
7. Client registration remains valid for at least the 30-day family lifetime while an eligible connection exists. Expiry cleanup must not erase consumed digest evidence before the corresponding family expires. The present SQLite and PostgreSQL registration retention check is based on one day and active grant references; DynamoDB extends the client row by one day on grant writes. These policies require adjustment. [S4, S5]

## Storage contract

Extend `ConnectorStorage` with typed family operations rather than composing `get`, `consume`, and `remove` in application code. The contract must distinguish current token, consumed token, unknown token, and wrong-client presentation without exposing another client's connection. Store a family status or generation checked by access verification. Access tokens reference family ID, allowing whole-family revocation in constant time. For code exchange, consume the code and create the initial family, refresh digest, and access digest in one atomic operation. For refresh, atomically compare current family generation and digest, mark the digest consumed, replace current digest and access digest, and advance inactivity expiry. For replay or disconnect, conditionally set family revoked. Adapter methods return an explicit outcome; no caller treats a failed transaction as success.

## Files to Change

| File | Planned change |
| --- | --- |
| `src/connector-auth.ts` | Shared lifecycle, grant selection, refresh exchange, access verification, and family revocation. |
| `src/connector-storage.ts` | Atomic contract and SQLite/PostgreSQL implementations. |
| `src/aws-connector-storage.ts` | Conditional DynamoDB family operations and retention. |
| `src/agent-server.ts` | OAuth metadata for implemented grants. |
| `migrations/004-connector-refresh.sql` | CREATE additive PostgreSQL family and digest schema. Existing migrations remain unchanged. |
| `test/connector-auth.test.ts` | SQLite, HTTP, browser, and security regression cases. |
| `test/connector-postgres.test.ts` | Real PostgreSQL transaction and restart cases when service is available. |
| `test/aws-identity.integration.test.ts` | TEST DynamoDB integration cases against the isolated service. |
| `test/connector-admission.test.ts` | TEST retention of refresh-eligible clients. |
| `docs/TEAM-SETUP.md` | Document renewal, expiry, rotation and reconnect behavior. |
| `src/migrate-hosted.ts` | Preserve refresh families, hash history and revocations during PostgreSQL snapshot migration. |
| `src/aws-migrate.ts` | Preserve refresh families, hash history, revocations and client retention during DynamoDB migration. |
| `test/connector-refresh-contract.ts` | Shared adapter conformance with forced race ordering, late-write failure injection, hash scans and operation counters. |
| `test/hosted-migration.test.ts` | Assert populated refresh record migration into PostgreSQL. |
| `test/aws-migration.test.ts` | Assert populated refresh record migration and client retention into DynamoDB Local. |

## Acceptance Criteria

- **AC-01 Registration and issuance:** Refresh-enabled registration and metadata advertise implemented grants; code exchange returns one-hour access plus opaque refresh; code-only clients receive no refresh. Test both selections and existing invalid-client rules.
- **AC-02 Binding and scope:** Renewal preserves actor/client/resource, allows only authorized scope narrowing, and rejects expansion or wrong-client/resource requests without cross-client effects. Recheck active identity and current pool permissions through connector calls.
- **AC-03 Lifetimes:** At exact one-hour access expiry, seven-day inactivity expiry, and thirty-day absolute expiry, enforce boundaries using a controlled clock. Rotation cannot extend the absolute lifetime. Retain registration while family is eligible.
- **AC-04 Atomic rotation:** One of two concurrent refresh attempts succeeds. The old access and refresh tokens fail after success. Inject transaction failure and prove rollback preserves the previous pair.
- **AC-05 Replay and disconnect:** Reuse of a consumed refresh digest revokes the family and all access tokens. Unknown and wrong-client tokens leave unrelated families active. Disconnect and concurrent renewal cannot revive a revoked family.
- **AC-06 Persistence and cost:** Persist only bearer hashes; prove restart survival. Assert indexed digest/family operations with constant transaction item/query count independent of rotation history; no family-history scan.
- **AC-07 Adapters and regressions:** Exercise SQLite, PostgreSQL, and DynamoDB with real services where available. Report skipped integration runs explicitly. Run type check, connector tests, browser consent flow, and existing PKCE, redirect/resource, and consent security tests.

Use synthetic users and tokens. Record RED and GREEN results in later implementation stages. The user authorized ticket, specification, and build. Independent review and behavioral proof remain required; no additional manual acceptance gate is introduced.

## Risks and unresolved dependencies

- Existing token rows have no family reference. The implementation must preserve verification and revocation behavior for preexisting unexpired code-only access tokens during migration or explicitly retain their current one-hour lifetime until expiry. [S1, S4]
- DynamoDB conditional transaction shape and registration TTL need real-service evidence; local mocks alone cannot establish those guarantees. [S5]
- PostgreSQL and DynamoDB integration services may be unavailable; a skip must be recorded, not counted as a pass. [S6]
- Independent classification and safety-sensitive design review must approve the behavioral cases before product-stage approval.

## Model Router

**Decision:** nightshift-architect. This changes a shared storage contract and several adapters.

## Sources

- **S1** `src/connector-auth.ts:29-40` (branch: main, commit: 02efda6) — registration grant normalization.
- **S2** `src/connector-auth.ts:80-103` (branch: main, commit: 02efda6) — code exchange, unsupported refresh, access verification, and current revocation.
- **S3** `src/repositories.ts:10-35` (branch: main, commit: 02efda6) — user and pool access operations available to the shared layer.
- **S4** `src/connector-storage.ts:7-18` (branch: main, commit: 02efda6) — current storage contract; `src/connector-storage.ts:43-59` (branch: main, commit: 02efda6) — SQLite client retention and transaction mechanics; `src/connector-storage.ts:77-91` (branch: main, commit: 02efda6) — PostgreSQL retention and consume mechanics.
- **S5** `src/aws-connector-storage.ts:7-25` (branch: main, commit: 02efda6) — DynamoDB TTL and transaction mechanics.
- **S6** `test/connector-postgres.test.ts:12-24` (branch: main, commit: 02efda6) — integration test service gate.
- `src/agent-server.ts:50-62` (branch: main, commit: 02efda6) — current metadata.
- `migrations/003-connector.sql:1-7` (branch: main, commit: 02efda6) — current PostgreSQL schema.
- `test/connector-auth.test.ts:47-57` (branch: main, commit: 02efda6) — current grant behavior; `test/connector-auth.test.ts:60-99` (branch: main, commit: 02efda6) — browser consent and binding regressions.
- `docs/11/ticket.json:1-1` (worktree source evidence) — task requirements copied from the resolved ticket.

## Review clarifications

- The two-refresh race has at most one successful response, but the losing replay revokes the family. After both finish, neither issued pair is valid.
- Deterministic tests use Node.js with the existing TypeScript loader; SQLite is embedded, PostgreSQL and DynamoDB Local are disposable services, and browser coverage uses the existing Chromium fixture. The scenario runtime field stays null because these cases are ordinary executable tests, not prompt prototypes. Service commands and endpoints are recorded in TEST-ENVIRONMENT.md.
- Storage-cost tests count SQL statements or DynamoDB requests and transaction items for an otherwise identical refresh/revoke after one versus many rotations. SQLite/PostgreSQL use primary-key digest/family lookups; no family-history query is permitted in renewal or revocation.
- A failed service run and an unavailable service are recorded separately from passing tests. Complete AC-07 evidence requires every adapter and browser flow to execute without skips.

Final review precision: issuance rollback leaves zero new family/token records and returns an error; wrong-client/unknown revocation returns 200 without state changes; capped expires_in rounds down, including 1500ms remaining → 1 second. The new additive migration path in Files to Change is a proposed CREATE, not a claim of an existing file.

## Operator policy amendment

The operator explicitly rejected arbitrary retry/time stop limits, instructed continued repair through completion, and requested Nightshift issue #155. Retain every prior failure as history; the former three-repair stop no longer governs this task. Correctness, independent review, source-transfer authorization and deployment boundaries remain in force.

The persistence design uses an immutable revocation tombstone checked in the same rotation transaction. PostgreSQL revocation locks the family row before publishing the tombstone; DynamoDB transaction checks serialize against its insertion. This prevents racing renewal from restoring an active connection without scanning token history. Migration helpers must carry all three new record types.
