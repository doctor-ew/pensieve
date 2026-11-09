# AWS identity, sharing and delivery keys

All items use pk/sk. `ttl` is epoch seconds for asynchronous DynamoDB cleanup. `expiresAt` is epoch milliseconds and must be checked on every use. Imports do not regenerate secrets or hashes. Preserve original hashes exactly. Account keys are in TEAM-KEYS.md.

## Login and sessions

- Login: pk `LOGIN#<browser hash>`, sk `<state digest>`; digest,browser,verifier,nonce,returnTo,expiresAt,ttl. Consume uses conditional Delete with ReturnValues and expiry.
- Session: pk `SESSION#<sha256 raw token>`, sk META; actor,identity(optional CognitoIdentity object),epoch,created,expiresAt,ttl.
- Reverse session: pk USER#actor, sk SESSION#digest; same fields plus digest. At most five active sessions admitted with optimistic user version transaction.
- USER META sessionEpoch defaults zero. revokeUser increments it; reads reject stale epoch. All caller mutations must preserve epoch and update version conditionally to prevent lost concurrent invalidation.
- Identity key is `IDENTITY#sha256(JSON.stringify([issuer,subject]))`, sk META; actor,issuer,subject. Explicit linking proves current personal token plus verified identity. A source account can move only while its authoritative USER META used flag is false. Every business mutation must atomically mark used=true.

Legacy hosted_sessions: digest -> session pk; actor, identity parsed JSON, expires -> expiresAt, created, epoch0. Add reverse record. cognito_login_states: digest/browser unchanged, return_to -> returnTo, expires -> expiresAt.

## Snapshots and invitations

`AwsShareStore.importSnapshot(snapshot)` preserves id/createdAt/expiresAt/revoked and returns `{snapshot,actions}`. It writes an immutable content-addressed S3 JSON object, then returns DynamoDB publication actions. The importer adds poolId/creatorId from team_shares to the SHARE META action before commit. Do not publish a share without its mapping. For idempotent migration compare source digest/receipt before invoking its absent-only actions.

- SHARE#id / META: id,objectKey,sha256,title,recipients,expiresAt,revoked,count,version,poolId,creatorId.
- SHARE-LIST / id: id,title,recipients,expiresAt,revoked,count. This is a bounded operator listing, not a tenant authorization index.
- SHARE#id / GRANT#<existing digest>: email,expiresAt,ttl. Legacy access table `digest` maps unchanged; `share` chooses pk; `expires` becomes expiresAt.
- SHARE#id / CHALLENGE#sha256(email): email,digest,expiresAt,ttl,attempts,sent,window,sends. Legacy challenges preserve every value; expires becomes expiresAt. ttl must remain at least window+one hour so expired codes do not reset rate limits early.
- SHARE#id / REVISION#version: archived prior META pointer; objects are immutable.

S3 writes require only PutObject/GetObject. Failed publication can leave an unreachable object, never a visible partial share. A retention/reconciliation procedure must collect unreachable objects later; no automatic destructive cleanup is implemented here.

## Connector

pk CONNECTOR#<legacy table name>, sk unchanged id/digest. Fields body (unchanged JSON string), expiresAt,ttl. For clients choose expiry at least max(issued_at+24h, related active grant expiry, migration time+24h). Other table expiry is the original milliseconds. Each use checks expiry; TTL alone is not authorization. Active transitions renew client expiry for24h.

Admission uses 100 registrations/minute plus1,000/day, replacing the prior permanent total-client cap. Pending authorization admissions are bounded per5-minute window. These global quotas prevent permanent exhaustion, but do not identify an attacker and can still cause temporary contention. Active grants retain their clients through renewal; idle clients eventually re-register.

## Delivery

pk DELIVERY#share / sk sha256(email), fields kind=delivery-job,state=pending|sending|sent|unknown|cancelled, actor,share,email,message (fixed InvitationMessage),created,claimed(optional).

Queued pointer: DELIVERY-QUEUE / share#sha256(email), jobPk,jobSk. Stream worker processes only kind=delivery-job,state=pending with `processDeliveryJob(pk,sk,mailer)`. Replays do not resend sent/sending/unknown jobs. Sending older than120s is reported unknown. An explicit reconciliation invocation `runBatch` can process queued pointers; no process interval is used. A crashed sending attempt requires a later invocation to persist unknown, though status reads already show unknown after120s.

Legacy delivery_attempts: status queued -> state pending only if a valid fixed stored message exists; status sending -> unknown during migration (never retry ambiguity); preserve sent/unknown/cancelled. Derive sk from email, preserve actor/share/email/created. Migrate quota timestamps per scope into MAIL-QUOTA#sha256(scope)/META with times array,version1,ttl. Limit array to active one-hour entries; excess should fail quota, not be discarded to admit sends.

## Verification

Root should run test/aws-identity.integration.test.ts and test/aws-sharing.integration.test.ts against explicit PENSIEVE_AWS_TEST_TABLE and PENSIEVE_AWS_TEST_BUCKET, serially. These tests do not claim live-service proof when skipped. No production table should be supplied.

CONVENTION_CHECK: AWS serverless — new repositories receive SDK/database/service collaborators through constructors; no existing class instantiation convention changed.

## Build receipt

Implementation files: src/aws-sessions.ts, src/aws-connector-storage.ts, src/aws-share-store.ts, src/aws-delivery.ts. Constructor-injected clients and clocks retain testability without substituting production persistence with in-memory state. Initial real AWS run passed five integration tests; final expanded test count is reported by the coordinator's test log. TypeScript check passed. No emails were sent by the tests: mailer doubles exercise delivery effects and uncertainty while DynamoDB and S3 remain real services.

Operational limits: snapshot bodies are capped at32MiB; operator global share listing returns at most100 summaries while creator lists use pool pagination. Delivery enqueue is atomic per recipient, not an all-recipient transaction: an interrupted request may resume missing recipients without duplicating existing jobs or quota charges. Global registration and login admission windows are bounded counters, not per-attacker bot identification. Dead-letter/reconciliation invocation remains composition-root responsibility.
