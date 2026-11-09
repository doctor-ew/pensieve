# Run and deploy the hosted platform

This branch builds the replacement hosted architecture. It does not switch the running Railway service or move existing data. Local SQLite mode remains available without `PENSIEVE_DATABASE_URL`.

## Development

Use Node >=22.13 and pnpm. Run `pnpm install --frozen-lockfile`, `pnpm check-types`, and `pnpm build`. A PostgreSQL server with the pgvector extension is required for hosted mode. Set `PENSIEVE_DATABASE_URL` through your local environment or deployment secret store, along with `PENSIEVE_OWNER_TOKEN`. Never put these values in git.

Run `node dist/cli.js team-server --home /path/to/local-state --port 7334`. Without Cognito configuration, personal invitations still authenticate. Set all three `PENSIEVE_COGNITO_ISSUER`, `PENSIEVE_COGNITO_CLIENT_ID`, and `PENSIEVE_COGNITO_DOMAIN` to enable customer login. The domain is the full HTTPS managed-login origin. Set `PENSIEVE_PUBLIC_URL` to the exact registered callback origin. For a remotely bound service use `--host 0.0.0.0` and an HTTPS public URL. The callback is `/auth/callback`.

Hosted mode uses pgvector and rejects a simultaneous Azure vector endpoint. Embeddings still require the configured provider; database hosting does not supply an embedding model. Reserve enough app memory if running a local model.

## Creator and agent flow

Creators sign in, create a private pool, save memories, and select memories to share. Lists load 50 at a time; **Select loaded memories** applies to the loaded pages. The advanced agent-access panel issues a personal credential once and replaces the previous personal credential. Store it in the CLI's connection configuration or secret store. The hosted connector retains OAuth consent, PKCE and resource binding and may use the existing browser session for consent.

Existing users prove their old personal invitation through **Link existing account** after Cognito sign-in. Matching email alone never merges accounts. Linking an already populated new account is rejected, so do this before creating new pools under that identity.

## Infrastructure and rollout

`infra/hosted` declares Cognito and an opt-in Route53 hostname record. Existing `infra/terraform` owns the SES identity/sender policy and its state; do not destroy it during this transition. `Dockerfile` and Railway configuration describe the app build. **Railway PostgreSQL provisioning, production backup scheduling and runtime secret wiring remain rollout work**, not resources this Terraform module claims to manage.

Before provisioning, record the selected Railway app/database sizes, measured embedding RAM, storage/backup retention, Cognito tier/MAU assumptions, SES volume and monthly budget. Review provider pricing and a saved Terraform plan. The Terraform mock test is configuration proof, not a live sign-in or email test.

1. Provision the approved PostgreSQL service privately, with pgvector, backups and credentials restricted to Pensieve. Confirm restore access and storage capacity.
2. Apply the reviewed Cognito plan with DNS creation disabled. Configure the app callback origin and SES sender. Keep sender credentials server-side with only the sender policy.
3. Freeze old writes and make consistent SQLite copies, including connector state. Follow [MIGRATION.md](MIGRATION.md).
4. Run `PENSIEVE_DATABASE_URL=... node dist/cli.js migrate-hosted --home /private/frozen-backups`. Expected names are `team.sqlite`, `team-shares.sqlite`, and `connector.sqlite`. Keep the JSON receipt privately; it contains paths and hashes, not credentials. The importer has no dry-run mode, is transactional and is safe to repeat with identical copies.
5. Start the hosted app, then test real login, legacy linking, CLI/MCP recall, selection, share access/revocation, and one explicitly requested invitation. Confirm sending status without assuming SES acceptance means inbox delivery.
6. Configure Railway's custom hostname/TLS, then enable the reviewed Route53 record. Keep the old reader hostname and share hashes so old URLs continue working.
7. Retain the frozen old store and database backup until the verification window closes. After new writes, rolling back requires reconciling those writes; pointing back to stale SQLite loses them.

## Verification

`PENSIEVE_TEST_DATABASE_URL=... pnpm test` runs real PostgreSQL tests alongside the local suite. The test database role needs disposable database/schema creation privileges; never point it at production. `PENSIEVE_TEST_DATABASE_URL=... pnpm exec tsx scripts/prove-hosted-restore.ts` creates two disposable databases, performs `pg_dump` and `pg_restore`, compares all table contents, and verifies credentials, session, share grant, provenance and vector recall. Matching PostgreSQL client tools are required. Only the generated databases and temporary proof files are removed.

## Known operational limits

Vector recall is exact search and grows with pool size; an approximate index requires measured recall/latency tradeoffs. Public connector registration has bounded global admission and reclaims inactive registrations after 24 hours. Sustained anonymous abuse can still cause temporary registration contention; measure this before opening broadly and add edge/per-source controls as needed. Outbox jobs preserve ambiguous sends as unknown and do not silently retry them. Authentication does not replace pool authorization, and an invitation-link share is usable by anyone holding its grant until expiry or revocation.
