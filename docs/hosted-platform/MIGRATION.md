# Hosted database migration (AC9)

The importer copies the existing team, share, and optional connector SQLite databases into one migrated PostgreSQL database. It preserves record IDs, credential hashes, invitation access, expiration/revocation state, provenance, policies, snapshot revisions, quotas, and connector grants. It never modifies the SQLite sources. The destination application must remain stopped until verification completes.

## Maintenance procedure

1. Stop all writers to the old service, including its connector and background workers. Keep that deployment and its volume available for rollback. Record the current application version and public origin; retaining the origin preserves existing reader URLs.
2. With writes frozen, use SQLite's backup operation for **each** source database. For example, `sqlite3 team.sqlite '.backup team-backup.sqlite'`. Repeat for the share and connector databases. Protect these files as production credentials: they contain private memories and credential hashes. Do not copy a live `.sqlite` file while ignoring its WAL.
3. Keep writes frozen across all three backups: a per-file snapshot does not establish consistency across databases. Move the completed backup files to the migration environment. Do not point the importer at the live service volume.
4. Provision PostgreSQL with pgvector and apply the checked-in SQL migrations using `migratePostgres(pool)`. Take a PostgreSQL backup before importing into a previously used destination. Use a dedicated empty destination for the first cutover.
5. Run `migrateHosted({teamPath,sharePath,connectorPath,pool})` from `src/migrate-hosted.ts` (the CLI delegates to this API). Omit `connectorPath` only if no connector state exists. Persist the returned receipt beside the protected backups. It contains paths, file SHA-256 hashes, and table counts; it contains no memory text or credentials.
6. Confirm receipt counts against source counts. Start the application against PostgreSQL with the same public origin. Check an existing personal credential, original pool and memory IDs, provenance, semantic search, existing reader invitation, revoked access, and connector authorization. Restart once and repeat access checks. Keep the old service stopped to avoid diverging writes.
7. Resume traffic only after these checks pass. Retain backups according to the configured retention policy.

## Transaction and conflict rules

The importer opens all sources read-only in SQLite read transactions. It rejects nonempty WAL files, unsupported tables, and unknown columns rather than silently losing data. Source file hashes are checked again before commit. Operators must still provide frozen copies: filesystem hashing cannot turn independently changing source databases into one coherent snapshot.

One PostgreSQL transaction takes the migration advisory lock and locks destination tables against writes, then imports in foreign-key dependency order. Identical existing rows are counted as unchanged. Conflicting primary-key rows, invalid vectors, missing references, or any other failure roll back the entire import. Tables without primary keys preserve duplicate multiplicities, so retrying the same import does not duplicate quota or revision rows. There is no destructive overwrite mode and no implicit source cleanup.

The old server issuer is preserved. An automatically initialized destination issuer may be replaced only when all other destination business tables are empty. A populated destination with a different issuer is rejected. Restart repositories after import: the application caches its issuer when opening its store.

JSON bodies remain byte-for-byte text. SQLite JSON vector arrays become pgvector `vector` values: that type stores float32 components, so each component is deterministically rounded to float32 and out-of-range values are rejected. This is the only intended numeric conversion. Original arrays remain in the hashed SQLite backups. SQL rowids are internal SQLite implementation details; application record IDs and provenance are preserved. Hosted pagination uses the record ID keyset.

New Cognito/browser-session tables have no legacy SQLite source and remain empty. Existing legacy verification-limit rows are retained for audit compatibility; hosted verification uses its new durable quota table.

## Rollback

Before hosted writes resume, an import failure requires no data repair: the destination transaction rolls back and the frozen SQLite deployment can be restarted. After hosted writes resume, do not revert traffic blindly to the stale SQLite copy. Stop writes, back up PostgreSQL, and reconcile any new hosted data before rollback. A PostgreSQL restore should be rehearsed into a disposable database, never over the only working database.

## Verification evidence

`test/hosted-migration.test.ts` uses actual SQLite stores and a disposable PostgreSQL database. AC9 tests verify original token access, snapshot access, issuer, provenance, vector search, repeated import, duplicate quota preservation, whole-transaction rollback after a late conflict, unknown-column rejection, and populated-issuer refusal. Run with `PENSIEVE_TEST_DATABASE_URL` pointing to a disposable-test-capable PostgreSQL instance; without it integration tests explicitly skip.

CONVENTION_CHECK: hosted-platform — new migration function receives its PostgreSQL pool explicitly; no existing classes modified.
