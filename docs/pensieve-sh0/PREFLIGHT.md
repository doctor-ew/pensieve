# Build preflight

Local verification on 2026-11-07:
- Full suite against real PostgreSQL 18 + pgvector: 116 passed, 0 failed, 0 skipped. Includes browser, auth, session restart, migration, registration admission and storage regressions.
- TypeScript checking and build completed.
- Production dependency audit: no known vulnerabilities found.
- Terraform recursive format check, hosted validate and mock test: pass (1 test).
- Actual pg_dump/pg_restore into a second disposable database: 25 tables identical; personal credential, provenance, share grant, session and vector recall verified.
- Independent code and security reviews: approve after fixes; see REVIEW.md.

The database restore uses synthetic fixture data. No real customer mail was sent. Live Cognito/SES, Railway PostgreSQL provisioning, migration of production data and custom-domain cutover have not been performed. Remote CI status belongs in the PR; local tests used Node 26 while CI exercises Node 22 and 24.
