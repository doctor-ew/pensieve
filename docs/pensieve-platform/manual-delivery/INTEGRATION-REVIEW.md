# Independent integration review

Scope: root-owned team-client.ts, team-cli.ts, team-service.ts; creator-owned team-server.ts and web/team.html/js; connector-auth.ts and agent-server.ts. Reviewer authored core/policy/store/Azure code and does not independently certify those modules. Manual delivery review only; no Nightshift gate status changed.

## Findings and dispositions

### IR-1 HIGH: historical queued context used the current invocation's policy file

Original team-cli.ts lines 36–38 and 60–62 passed `localPolicy(options)` for every queued row, ignoring the original repository/conversation policy file. Reproduction queued synthetic repository A, changed A's config to private, then invoked actual `runTeamCommand('sync')` with repository B's shared config for the same pool. Actual result: sent=1, held=0, one unexpected publication from A.

Controller repair persists absolute policyFile in CaptureContext (current team-cli.ts:25) and resolves it when flushing (39, 63). Repeated reproduction with the newly recorded policyFile: sent=0, pending=1, held=1, unexpected publications=0. Reproduction script `/tmp/pensieve-policy-review.ts` uses a deterministic fetch double and only synthetic memories. Historical rows created by the unreleased earlier implementation without policyFile cannot recover their original policy path; do not migrate such prototype rows silently.

### IR-2 HIGH: automatic watcher ignored remote autoSave and conversation context

Original team-cli.ts:47 checked only local autoSave and passed `options.session` as context instead of the parsed source memory's session. A remote conversation-specific stop could therefore be bypassed, and remote autoSave=false still allowed automatic contribution. Controller added source session and automatic flag at current team-cli.ts:32; queue now checks effective autoSave at team-client.ts:62. Code repair verified; dedicated automatic watcher regression tests should remain in integrated acceptance.

### IR-3 HIGH: saved personal credential could be sent to a newly overridden origin

Original team-cli.ts:15 independently merged environment URL with saved token. Changing only PENSIEVE_TEAM_URL could send the saved account credential to another service. Current line15 rejects changed origin unless an explicit new token is supplied. Code repair verified; controller should retain a no-request regression test.

### IR-4 MEDIUM: creating a pool left the previous pool selected

web/team.js:22 originally discarded create-pool response and called choose(), whose line17 retained the previous select value. Creating a private pool while viewing shared could leave subsequent Save targeting shared. Creator agent notified; select the newly returned pool ID and verify in browser. Status pending creator confirmation/review of repair.

### IR-5 MEDIUM: sync of an empty pool calls an invalid selected export

team-cli.ts:66 originally called export with empty IDs when the pool had no memories, while the server deliberately rejects empty selections. Skip empty export and report pulled=0. Controller notified; pending repair verification.

### IR-6 MEDIUM: optional queue policy callback permits unchecked publication

team-client.ts:55 makes currentPolicy optional; line62 only enforces current policy if callback exists. Current production CLI call sites provide it, so no current CLI bypass is claimed. Require the callback or fail closed without it to preserve the queue API's no-stale-publication contract. Controller notified; pending repair verification.

### IR-7 MEDIUM: stdio agent drops synthetic status

team-service.ts:21–22 lacks synthetic in its tool schema and constructed memory, unlike HTTP agent-server.ts:21/28. A synthetic memory passed via stdio loses its explicit label. Add optional boolean and preserve it. Controller notified; pending repair verification.

## Auth and server inspection

Reviewed host/origin checks, personal-token/session isolation, same-origin browser mutations, active-user checks, role enforcement before index/share, selected export/share authorization, share ownership mapping, safe textContent rendering, invitation fragment handling, and HTML escaping of OAuth client names. No additional concrete authentication blocker found in this pass.

Connector PKCE is checked by installed SDK token handler before provider exchange (node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/handlers/token.js:67–73). Code/redirect/resource/client binding and actor liveness are enforced in connector-auth.ts:79–108. OAuth authorization/register/token/revoke handlers have SDK rate limits; consent has an explicit limiter. This is source inspection plus synthetic integration, not proof of a live Claude account handshake or deployed proxy configuration.

Actual verification command:

```sh
pnpm exec tsx --test test/connector-auth.test.ts test/agent-server.test.ts test/team-server.test.ts test/team-client.test.ts
```

Result: exit 0, 17/17 pass, including official SDK HTTP/stdio tests, OAuth replay/binding/revocation, creator sessions, ACLs, policy and share isolation. Final integrated tests, browser proof and review of repairs remain controller-owned.

## Re-review: IR-1 through IR-7 closed for this delivery

- IR-1: original policyFile is retained and resolved; real CLI integration test `CLI sync rechecks the queued original policy file even when invoked with another config` passes. Independent adversarial reproduction reports no unexpected publication.
- IR-2: actual parsed session ID and automatic flag reach queue policy resolution; CLI watcher integration stops on conversation off and remote autoSave=false, then publishes once enabled. Exact-project exclusion is exercised.
- IR-3: changed-origin/no-new-token fails before constructing a client. Independently executed connectedClient against synthetic saved credentials and changed environment origin; rejects with Changed server and no HTTP request.
- IR-4: web/team.js choose(preferred) selects created.pool.id. Browser test creates a new private pool from a shared pool, captures next memory, and verifies its destination.
- IR-5: team-cli.ts:66 reports pulled=0 without exporting an empty pool. CLI hold tests exercise empty pools successfully.
- IR-6: team-client.ts:55 requires currentPolicy and line62 holds rows if omitted at runtime. Independently invoked through an untyped call with no resolver: zero send calls, held=1.
- IR-7: team-service.ts:21–22 now declares and preserves synthetic. Independent official SDK in-memory client call against remoteAgentServer's actual tool schema with synthetic=true reached a deterministic HTTP double with saved.memories[0].synthetic=true.

Actual integrated review verification: `pnpm exec tsx --test test/team-cli.test.ts test/team-client.test.ts test/team-browser.test.ts test/team-server.test.ts test/agent-server.test.ts test/connector-auth.test.ts` returned exit0, 25/25 pass (~10 seconds). `test/agent-server.test.ts` is not a separate file; the SDK agent tests are in connector-auth.test.ts. `pnpm exec tsc --noEmit` returned exit0. No claim of production deployment or live Claude/Azure handshake.

Core repairs from the separate independent reviewer were implemented by this reviewer and therefore are NOT self-certified as independent review: downgrade-to-reader denies share listing/revocation while retaining read/export; >10000 accumulated memory indexing chunks remote upserts while retaining all-or-nothing local receipts. Dedicated team-store suite 15/15 passed, including 10001 synthetic records and last-chunk failure/retry. Creator UI now skips share management fetch for readers to preserve normal read/download flow. A separate reviewer must assess these core changes.
