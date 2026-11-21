# Connector refresh-token implementation

Status: implemented and verified in the local working tree. Production has not been changed.

Refresh-enabled public clients retain both supported grants and receive opaque rotating refresh credentials. Access lasts one hour, capped by the thirty-day connection deadline; refresh eligibility ends after seven days of inactivity. Scope narrowing persists. Owner replay, disconnect and identity revocation prevent continued access.

Lifecycle policy stays in the shared authentication layer. Storage provides compare-and-swap transactions and immutable family-revocation tombstones. Rotation checks the tombstone in the same transaction as the new pair. PostgreSQL revocation locks the same family row; registration acquires family-table locks before token-table locks. DynamoDB retries transaction contention without treating unrelated errors as a successful write. Access validation checks the family and current access digest, so family revocation needs no history scan.

The additive PostgreSQL migration creates the three new record tables without changing existing migrations. SQLite and DynamoDB snapshot migration preserve family, refresh-history and revocation rows and sufficient client retention. Existing code-only clients and preexisting access-token records remain supported.

The consent compatibility repairs remain in place: same-origin referrer policy and a callback-origin CSP allowance. Exact headers are asserted for both client kinds; Chromium consent reaches the callback.

## Verification

See VALIDATION.json and validation logs. Shared adapter tests execute against SQLite, PostgreSQL and DynamoDB Local with late-write rollback, forced overlapping refresh, expiry boundaries, foreign-client isolation, hash-only persistence and operation counters. Additional PostgreSQL tests hold actual family locks in both race orders and during registration. DynamoDB tests inject conflict responses before real writes. Both snapshot migration paths carry populated refresh records.

The independent review identified contention handling and test-depth gaps; these were fixed and the targeted re-review approved the repairs. Prior failures remain retained. The operator explicitly removed arbitrary retry/time stop limits for this task; Nightshift policy work is tracked in issue 155.

No live Claude acceptance, publication, installation replacement or production deployment is claimed.
