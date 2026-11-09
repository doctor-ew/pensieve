# Hosted storage implementation

## Plan and blast radius

Approved spec implementation touches repositories.ts, postgres.ts, pg-team-store.ts, pg-share-store.ts, pg-delivery.ts, migrations/001-platform.sql and test/postgres-storage.test.ts. Existing classes are unchanged. Browser/API/connector callers must await the new repository contracts; local synchronous implementations remain assignable. No partner applications are affected.

Sequence: define awaitable contracts; create a versioned schema and transaction helper; port team operations and exact vector retrieval; implement transactional snapshots and reader grants; implement durable enqueue/worker receipts; verify against real PostgreSQL. Planet sizing: Planet (cross-module integration), storage slice implemented here.

## Implemented contracts

- postgresPool(connectionString), migratePostgres(pool), transaction(pool, callback): pooled connections, serialized/checksummed migrations, explicit transaction ownership.
- await PgTeamStore.open(pool): current team operations plus listMemoryPage, atomic createShare and rotatePersonalToken. sourceServer preserves the imported issuer. close is a no-op: the composition root owns the pool.
- new PgShareStore(pool): snapshot/reader grants and challenge compatibility. Invalid code attempts commit their counter; successful codes are consumed under row locks.
- new PgDeliveryLedger(pool): enqueue/send, runBatch, reserveCode, statuses and checkVerification. Worker only retries queued work; stale claimed attempts become unknown. Stored snapshot authorization and recipients are rechecked, and bearer invitation grants are generated immediately before sending.

## Acceptance coverage

AC1: concurrent/repeated migrations on real PostgreSQL pass. AC2: ACLs, idempotency/conflict rollback, selected exports and SQL exact pgvector retrieval pass. AC3: keyset pages have bounded limits, stable ID ordering and no duplicates in a stable dataset. AC5 storage: identity mapping races/revocation and personal-token rotation pass. AC6: snapshot and mapping atomicity, supplied bundle substitution rejection, reader grant and one-time code semantics pass. AC7: concurrent enqueue/worker claims, uncertain outcome suppression and revoked-job cancellation pass. Root integration owns remaining browser/auth/migration/deploy proof.

Validation: PENSIEVE_TEST_DATABASE_URL set to the disposable local PostgreSQL18/pgvector server; test/postgres-storage.test.ts passed 6/6 without skips. Each run creates and drops only a uniquely named test database. pnpm check-types passed after repository integration.

## Limits

Exact vector search remains linear in candidate vectors plus SQL ordering; no approximate index performance claim. Indexing batches embedding calls by16 but currently collects pending records before commit. listMemories remains an unbounded compatibility method; browser traffic should use listMemoryPage. Snapshot reader arrays are intentionally bounded by explicit share selection. Email delivery remains at-most-once attempts, not exactly-once delivery; a crash after claim may leave unknown and must not silently resend. Hosted repositories share one pg Pool; local SQLite remains unchanged.

CONVENTION_CHECK: hosted-platform — no existing classes modified; new repositories receive their pg Pool through constructors, consistently with explicit service composition.

## Review blocker remediation

- Added `TeamRepository.listSharePage`: pool-scoped owner/creator authorization in SQL, summary-only projection, stable ID cursor, default 50/max 100. Hosted callers avoid global full-snapshot scans.
- Import writes use 250-record bulk inserts, set-based conflict reads, and bulk provenance writes within the existing all-or-nothing transaction.
- Indexing reads 16 records per keyset page and bulk-stages vectors in a connection-local temporary table. Provider calls run outside transactions. A final transaction rechecks authorization/dimensions and publishes all staged vectors atomically; failure drops staging without partial publication.
- Validation: `pnpm check-types` passed; real PostgreSQL/pgvector storage suite passed 8/8, no skips. New coverage exercises 530-record import/index, late conflicting import rollback, provider failure after staged batches, provenance idempotency, and scoped share pagination.
- Operational tradeoff: indexing reserves one pool connection during embedding calls. It bounds application memory and avoids long-running transactions; overall runtime still scales with the selected pool size. PostgreSQL temp storage holds unpublished vectors.

CONVENTION_CHECK: hosted-platform — repository dependencies remain constructor-injected; no new external collaborators.
