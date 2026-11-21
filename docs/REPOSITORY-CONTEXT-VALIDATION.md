# Repository context validation — 2026-11-20

Implemented on `fix/agent-auth-recovery`, incorporating AWS branch commit `93383f6` (connector consent and refresh-token fixes).

## Completed

- `npm run build` and TypeScript checking pass.
- Full `npm test`: 167 tests, 147 passed, 20 skipped, 0 failed. The skips require configured PostgreSQL or DynamoDB integration-test databases; they are not live AWS validation.
- After the final ranking/layout changes, all six focused tests in `test/code-context.test.ts` pass, including a real headless browser flow. The full suite above ran before those final changes.
- Tests cover MEX-derived identity stability, scope isolation, committed-only extraction, symlink/hidden/untracked exclusions, stale snapshots, removal on reindex, exact-symbol ranking, explicit-selection publishing, pool authorization, idempotency, remote recall, local MCP access without cloud credentials, and UI review before publishing.
- Agent regression testing verifies that one running stdio process reports a rejected credential, picks up a replacement saved connection, changes accounts without leaking the previous account's pools, and rejects a revoked account.
- A local index of the existing Pensieve AWS source at `c1b093bbb055e7de65f8c23125425aa506a8f068` produced 3,464 symbols in 106 source files. Searching for `rotatePersonalToken` returned an exact method match with a source-file/line citation. No source was uploaded for this check.
- `git diff --check` passes.

The initial sandboxed browser run failed to launch Chrome and was stopped. The suite was rerun with approved execution outside the sandbox; the passing counts above refer to that rerun.

## Live access remains separate

Read-only checks of the AWS deployment confirmed that both existing local personal credentials were rejected with HTTP 401 and had no matching token mapping in the configured DynamoDB table. Chrome showed a signed-in Pensieve account. No credentials were created, rotated, disclosed, or restored by this implementation. The user was asked to complete the credential-change step privately; a successful live MCP call is still required after reconnecting.

No AWS deployment or production code publication is established by the local tests. Publishing selected source in the application tests used a local synthetic server.

## Scope

This first slice reuses MEX's stable symbol identity algorithm with attribution. It does not include MEX's complete graph engine, cross-file call resolution, additional languages, hooks, or automatic cloud repository synchronization. Source and constraints: [REPOSITORY-CONTEXT.md](REPOSITORY-CONTEXT.md).

## CI follow-up

The initial CI run passed infrastructure, AWS packaging, and container checks, but the new browser test used a macOS-specific screenshot path. The test now uses Node’s system temporary directory on every platform. This change does not alter application behavior.
