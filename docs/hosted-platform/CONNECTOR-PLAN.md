# Connector implementation plan

Approved by root coordinator before implementation. Scope: src/connector-storage.ts, connector-auth.ts, agent-server.ts, migrations/003-connector.sql, test/connector*.test.ts. No external partner APIs change.

1. Add async SQLite/PG storage adapter preserving hashed credential schemas.
2. Await repository and persistence methods throughout authorization and MCP tools.
3. Atomically consume pending/code grants and issue successors, preserving PKCE/resource/redirect validation.
4. Verify local compatibility plus real-PG restart and concurrent replay behavior.

Risks: asynchronous interleaving must not duplicate OAuth grants; mitigate through conditional delete+insert transactions on one connection. Shared Pool lifecycle belongs to application. No production changes.
