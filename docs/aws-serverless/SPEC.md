# AWS serverless implementation specification

Approved by user: implement Lambda + DynamoDB + S3 Vectors, preserve SQLite/Railway branch, target near-zero/free allowances and no always-on infrastructure. Architecture and works cited: ARCHITECTURE.md. This is an AWS-branch implementation, not an automatic merge into the Railway branch. Deployment hostname: pensieve.doctorew.com. Existing identities/memories/share grants must survive migration. Never claim $0 or production success from mocks.

## Acceptance criteria
1. Explicit repository interfaces replace concrete SQLite-derived public contracts; existing local behavior remains tested.
2. DynamoDB key-based access for identities, memberships, memory pages, grants, sessions and durable work; no request-path table Scan. Cursor pages default50 max100.
3. Memory + durable indexing intent commit atomically with authorization/version conditions. Atomic publication for large batches, with bounded chunks and no partially visible import on conflict.
4. S3 Vectors adapter filters pool/model and returns candidate IDs/revisions; authoritative reads and current authorization guard every returned memory. No vector metadata treated as access permission.
5. Idempotent indexing handles retries and stale events. Worker invocation is event-driven, not an in-process interval. Failures remain durable/observable and retryable without hiding incomplete work.
6. DynamoDB-backed Cognito login state and sessions retain browser binding, nonce, verified claims, hashed credentials and explicit legacy identity linking. Preserve existing Cognito verifier.
7. Connector auth transitions remain atomic and durable on DynamoDB, with bounded registration admission and inactive expiry; do not silently weaken PKCE/resource checks.
8. Sharing publishes an immutable selected snapshot with an atomic authorization/visibility marker. Hash grants/challenges; preserve revoke/expire behavior. Large snapshot bodies may use immutable S3 objects, referenced only after commit.
9. Email intents are authorized, deduplicated, quota-bound and worker-driven; ambiguous send remains unknown. SES uses IAM role rather than new static IAM keys.
10. Lambda API, worker and migration entrypoints package correctly and handle HTTPS/custom domain. No DB migrations/model download/background loop during each request. UI and MCP behavior is proven, with Lambda transport limitations explicitly tested.
11. Terraform declares Lambda, DynamoDB, S3/S3 Vectors, events/IAM, ingress/custom domain/TLS, bounded logs, budgets, identity integration and SES reference. No NAT, ALB, always-on task or Aurora. Prevent destructive replacement of production data.
12. Import frozen SQLite state preserving IDs/hash grants/provenance; idempotent conflict detection and restore proof. Keep Railway service running during staging, no destructive source cleanup.
13. Failure tests, real AWS canary, independent code/security review, browser create/save/query/share/download/revoke smoke before DNS cutover. Costed plan and measured resources remain under the approved $25 ceiling while targeting free allowances.

## Files to change / ownership
- Storage architect: src/repositories.ts, src/aws-db.ts, src/aws-team-store.ts, test/aws-storage*.test.ts. Own key schema for team entities; coordinate shared DB helper API with other agents.
- Identity/sharing architect: src/aws-sessions.ts, src/aws-share-store.ts, src/aws-delivery.ts, src/aws-connector-storage.ts, src/connector-auth.ts, src/connector-storage.ts, test/aws-identity*.test.ts, test/aws-sharing*.test.ts. Coordinate teams keys/atomic shares with storage architect.
- Infrastructure architect: infra/aws-serverless/**, Dockerfile.aws, scripts/build-aws.*, docs/aws-serverless/INFRA.md, .github/workflows/aws.yml. Coordinate handler/env requirements with root. No production apply by agent.
- Root: src/aws-runtime.ts, src/aws-handler.ts, src/aws-worker.ts, src/aws-vectors.ts, src/aws-migrate.ts, src/team-server.ts, src/identity-routes.ts, src/agent-server.ts, src/cognito.ts, src/embeddings.ts, src/ses-mailer.ts, src/cli.ts, package.json, pnpm-lock.yaml, scripts/*aws*, test/aws-runtime*.test.ts, test/aws-vectors*.test.ts, test/aws-migration*.test.ts, docs/aws-serverless/**, .Codex/task-progress/**, README.md.

## Implementation boundaries
Keep the existing public routes and transport independent domain contracts where possible. Native Lambda response buffering is acceptable only where MCP stateless JSON transport is proven; do not claim an indefinitely streaming connection survives Lambda termination. Embeddings use an explicitly configured model; usage is separately metered. A failure to authorize or fetch authoritative state fails closed. Root coordinates any necessary scope additions rather than silently omitting functionality.
