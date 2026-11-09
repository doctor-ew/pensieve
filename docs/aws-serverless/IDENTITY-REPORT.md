# Identity and sharing implementation report

## Files

- src/aws-sessions.ts: browser-bound one-use login state, hashed durable sessions, maximum five sessions, epoch revocation, proof-based legacy identity linking.
- src/aws-connector-storage.ts: atomic OAuth grant consumption, logical expiry, bounded registration admission and client renewal.
- src/aws-share-store.ts: immutable S3 snapshot objects, atomic pointer-publication actions, preserved grant hashes, challenge attempt limits, final authoritative revocation checks.
- src/aws-delivery.ts: per-recipient atomic authorized enqueue and quota reservation, idempotent worker claim, unknown status for ambiguous sends, resumable partial enqueue, batched status lookup.
- test/aws-identity-fixture.ts: explicit real AWS test target, paced SDK requests, exact-key/preimage journal and cleanup; no table Scan.
- test/aws-identity.integration.test.ts and test/aws-sharing.integration.test.ts: AC6/7/8/9 regression coverage.

## Verification

2026-11-08 final run against real AWS DynamoDB and S3: **6 passed, 0 failed, 0 skipped**, duration46.9s. TypeScript check passed. Fixture mailers are doubles, so this verifies state transitions and delivery uncertainty without sending live mail. Final run's persistent cleanup journals were removed only after successful exact-key/object cleanup.

Earlier unpaced repeated tests exhausted the table's provisioned throughput. One older run failed during in-memory-only cleanup; possible synthetic leftovers were explicitly reported to the coordinator. The later fixture persists a private recovery journal before writes and paces operations, so new cleanup failures can be recovered without scanning. Production migration must not assume the canary table is empty merely because the final suite passed.

## Integration

Constructors: AwsLoginStates(db,now?), AwsHostedSessions(db,now?), AwsConnectorStorage(db,now?), AwsShareStore(db,s3,bucket,now?), AwsDeliveryLedger(db,shares,team,now?). Team storage receives shares.prepareSnapshot; it adds poolId/creatorId to the SHARE META publication item and commits with authorization and mapping. Worker processes delivery-job/pending stream items with processDeliveryJob(pk,sk,mailer). Migration schemas and importSnapshot hook are documented in IDENTITY-KEYS.md.

All classes receive collaborators through constructors. Existing connector authorization logic was not changed. No commits or production deployment performed by this slice.

CONVENTION_CHECK: AWS serverless — constructor-injected collaborators; no existing class dependency pattern changed.
