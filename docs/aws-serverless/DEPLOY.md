# AWS deployment receipt — 2026-11-08

## Verified
- Terraform applied DynamoDB, private S3 snapshots, S3 Vectors, Cognito, API Gateway, API/worker Lambda, failure queue, budget and GitHub OIDC role.
- AWS account 432230020714, us-east-1. S3 backend key: pensieve/aws-serverless.tfstate.
- Frozen Railway SQLite backups remain private at ~/.pensieve/aws-migration/20261108. Source service unchanged.
- Imported 4 users, 5 pools, 13 memories, 3 shares and 3 hashed access grants; 72 destination records. Migration visibility marker is ready.
- Compared every source memory and contributor, user credential hash, share bundle and grant expiry against AWS: PASS.
- Local suite: 102 passed, 17 integration tests skipped because service environment variables were absent. Separate real-AWS storage tests: 3 passed; identity/sharing: 6 passed (see STORAGE-REPORT.md, IDENTITY-REPORT.md).
- Focused runtime/vector tests: 6 passed, including origin-token rejection and warm issuer refresh.
- Terraform mocked tests: 3 passed including CloudFront policy and DNS cutover gate.

## In progress / not yet claimed
- Dedicated CloudFront deployment and live HTTP/browser smoke.
- Worker enablement and migrated-memory reindex proof.
- Production pensieve.doctorew.com DNS cutover.
- Publish branch/PR and execute GitHub OIDC workflow. GitHub Actions is enabled at repository level; deployment workflow has not run.

## Edge and cost boundary
User chose dedicated CloudFront with an existing CloudFront WAF; Cloudflare is not being configured. Root doctorew.com website and DNS remain untouched. Existing WAF rules are Count-only, not blocking. No ACL rules are edited and no additional ACL fixed fee is introduced; CloudFront/WAF request charges still apply. The API rejects requests without its configured CloudFront origin token; this application-layer check does not eliminate direct-origin request costs.

## Deployment corrections
Cognito requires PASSWORD alongside EMAIL_OTP and rejects the reserved word aws in its login-domain prefix. These were corrected to PASSWORD + EMAIL_OTP and pensieve-login-432230020714. The GitHub role/backend example were corrected to the existing state key to prevent a second empty deployment state.
