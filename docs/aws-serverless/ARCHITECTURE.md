# AWS serverless architecture and engineering gates

Status: proposed replacement for the Aurora deployment design. Implementation effort is not a reason to retain PostgreSQL. Optimize for bounded usage cost, maintainability, correct authorization and recoverability. No infrastructure has been deployed by this decision. The separate deploy/railway-sqlite branch remains available.

## Responsibilities

- Lambda serves the application/API and independently invoked background work. No process-local sessions, interval-based outbox worker, always-on container or provisioned concurrency requirement.
- DynamoDB is authoritative for account/pool authorization, memory revisions, share grants, sessions and durable work state.
- S3 Vectors is a rebuildable semantic index. Store pool ID, memory ID, immutable revision and model identity in index records. It does not grant access or replace authoritative memory records.
- Cognito supplies customer identity; Pensieve supplies authorization. SES sends fixed, authorized invitations. Terraform declares infrastructure and IAM.
- Preserve one application/domain layer with small provider interfaces; do not split business rules into unrelated microservices merely because Lambda supports multiple functions.

## DRY and SOLID

Use shared domain services for capture policy, membership, selected-memory snapshots and delivery decisions. Browser, CLI and MCP call these services. Define explicit minimal interfaces rather than deriving the public contract from a concrete SQLite class. Adapters implement persistence primitives; application services own workflows and policies. Identity, authorization, memory persistence, vector retrieval and delivery have separate contracts. SQLite and AWS implementations receive the same behavior tests where semantics match; asynchronous indexing states are explicit where they differ.

## ACID boundary and failure recovery

DynamoDB transactions are the atomic boundary. A memory revision and its durable indexing intent must commit together. A committed share must reference a completed immutable selection; authorization and relevant version checks belong in the commit, not only in an earlier read. DynamoDB transactions support at most 100 distinct items and 4 MB, and an item is limited to 400 KB. These are design constraints, not limits to discover in production [1,2].

Large imports/shares require staged immutable chunks and a final publication marker. Readers never expose incomplete staging. A final authorization/version check precedes publication. Define explicit size/count limits and garbage collection for abandoned staging. Do not describe a multi-transaction import as an atomic transaction; document the atomic visibility boundary separately.

There is no shared transaction spanning DynamoDB, S3 Vectors and SES. Use durable indexing intents, idempotent consumers, immutable revision keys and conditional state transitions. Stream delivery can repeat [3]. Mark an index revision ready only after its write succeeds. Failed work remains observable and recoverable; define dead-letter retention and reconciliation before shipping. Do not assume the stream itself is a permanent job ledger.

Recall queries the authorized pool's vector index/filter, then batch-loads authoritative records and checks current membership, deletion state and revision before returning text. Old/replayed index writes must not resurrect deleted content or expose revoked pools. Never trust text or access claims returned from vector metadata. Bounded refill can improve short results, but must not become an unlimited search loop. Index lag may reduce recall temporarily; it must not weaken access controls.

Email keeps the existing explicit uncertain-send state. SES acceptance and subsequent persistence are not atomic; an ambiguous attempt is not silently retried as though no email was sent.

## Big O and access patterns

Before implementing keys/indexes, enumerate requests: actor pools, pool memory page, selected memory batch, creator/owner shares, grant lookup, session lookup, pending work, policy context and bounded semantic recall. Each needs a key/query design, page limit and authorization rule. No request-path table Scan and no per-result network request loops.

Memory/share lists use bounded cursor pages. Imports use bounded batches with explicit publication semantics. Recall performs one bounded vector query plus batched authoritative reads; filter by authorized pool at the vector query and revalidate on return. Measure vector recall, latency, request units and filtered-result behavior; do not claim O(log N) for a managed vector engine without evidence. DynamoDB key access does not by itself make the whole workflow constant-time.

## Cost and deployment gates

Target free allowances and low usage-based spend, not an unconditional $0 guarantee. Lambda and DynamoDB advertise allowances; DynamoDB provisioned throughput allowances are not the same as free on-demand requests [4,5]. S3 Vectors bills storage and operations [6]. Include API ingress, DNS, email, logs, backups, encryption options, data transfer and embedding usage in the estimate. Check this account's available allowances rather than treating them as dedicated to Pensieve.

No always-on Fargate task, NAT gateway, load balancer or Aurora cluster is part of this proposed baseline. Choose ingress and SDK network access together so the runtime does not accidentally require a fixed-cost network component. Bound concurrency, request sizes, logs and retention. Budget alerts notify; do not represent them as a hard spending cap.

Outstanding product choices already requested: whether near-zero AWS spend or strict free takes precedence; acceptable cold-start delay; invited-only versus public creator signup. These determine rollout policy, not whether domain tests and adapter design can proceed.

## Required proof before cutover

1. Shared domain contract tests for supported SQLite/AWS behavior.
2. Real-service adapter tests; mocks alone cannot establish transaction/conditional-write behavior.
3. Duplicate, delayed and out-of-order indexing events; crash after vector write and before acknowledgement; deletion and permission revocation during recall.
4. Staged import/share interruption and replay; no partially published selection.
5. End-to-end browser and MCP identity, save, recall, selected share, download and revoke.
6. Backup/restore plus existing share-ID/grant preservation, or an explicit compatibility bridge before changing the public hostname.
7. Measured workload cost and independent DRY/SOLID/ACID/Big O/security review.

## Sources and existing code

[1] https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html
[2] https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html
[3] https://docs.aws.amazon.com/lambda/latest/dg/with-ddb.html
[4] https://aws.amazon.com/lambda/pricing/
[5] https://aws.amazon.com/dynamodb/pricing/
[6] https://aws.amazon.com/s3/pricing/
[7] https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-query.html

Existing adapter seam: src/repositories.ts. Existing PostgreSQL transaction implementation: src/pg-team-store.ts. Existing process-bound service composition to replace for Lambda: src/team-service.ts. Existing browser/connector session implementations: src/hosted-sessions.ts and src/connector-storage.ts. These are implementation references, not claims that AWS adapters already exist.
