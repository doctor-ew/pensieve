# Connector implementation report

## Files

- src/connector-storage.ts: async storage contract, existing SQLite adapter and PostgreSQL adapter. Uses the shared transaction helper; Pool lifecycle belongs to application.
- src/connector-auth.ts: asynchronous persistence/identity checks; atomic pending/code consumption; provider-enforced PKCE; hashed credentials; trusted browser-session consent fallback.
- src/agent-server.ts: all repository access awaited; optional ConnectorStorage and sessionUser callback; same-origin explicit consent retained.
- migrations/003-connector.sql: persistent clients, pending requests, codes and tokens, compatible legacy columns and expiry indexes.
- test/connector-auth.test.ts: existing six regressions plus trusted-browser explicit consent proof.
- test/connector-postgres.test.ts: isolated real PostgreSQL schema, concurrent consent/code replay, restart, hashes, resource/PKCE and revocation proof.

AC8: implemented. Eight tests passed with zero skips against local PG18; SQLite compatibility and official SDK HTTP/stdio clients pass. Migration of legacy connector rows is the root migration runner's responsibility; schemas preserve IDs/hashes/body/expiry.

Integration: createConnectorApp accepts storage:new PgConnectorStorage(pool), optional sessionUser(cookieHeader). Session callback must resolve identity server-side; never pass caller body IDs. Connector.close does not end shared PostgreSQL Pool.

SDK detail: skipLocalPkceValidation=true causes SDK to forward the code verifier. ConnectorAuth itself validates S256 before conditional consumption, including direct callers. Missing/bad verifier fails closed.

CONVENTION_CHECK: hosted-platform — persistence is constructor-injected with a local SQLite default, matching existing store/publicUrl/path constructor dependencies; no global connection or per-request Pool.

No production changes or commits performed.
