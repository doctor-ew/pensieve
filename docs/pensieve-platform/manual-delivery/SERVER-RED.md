# Creator server RED baseline

Manual takeover evidence; not a Nightshift gate.

Command: `pnpm exec tsx --test test/team-server.test.ts`. Result: exit 1 before any application implementation.

The suite cannot import the new `src/team-store.ts`/`src/team-server.ts` contracts, which do not exist yet. The shell used to summarize the log also hit zsh's reserved `status` variable after the test had run; the original test output below is retained separately from that shell error.

```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/team-server.test.ts
    at finalizeResolution (node:internal/modules/esm/resolve:241:11)
    at moduleResolve (node:internal/modules/esm/resolve:846:10)
    at defaultResolve (node:internal/modules/esm/resolve:973:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:752:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:772:38)
    at nextStep (node:internal/modules/customization_hooks:189:26)
    at resolveBaseSync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:11092)
    at resolveDirectorySync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:12398)
    at resolveTsPathsSync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:13605)
    at resolve (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:16832) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js'
}

Node.js v26.12.0
✖ test/team-server.test.ts (140.763334ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 144.76775

✖ failing tests:

test at test/team-server.test.ts:1:1
✖ test/team-server.test.ts (140.763334ms)
  'test failed'

```

Coverage prepared: operator invitation versus creator credentials, cross-user pool isolation, reader/writer/owner permissions, invitation reader/download isolation, protected browser sessions and cross-origin mutation rejection, missing embedding provider, revocation, and atomic batch conflict rollback.

## Expanded security baseline

Seven HTTP integration tests now include scoped share management, foreign Host denial, malformed JSON and browser logout. Rerun `pnpm exec tsx --test test/team-server.test.ts` exited 1 before implementation with missing `src/team-store.js`.

```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/team-server.test.ts
    at finalizeResolution (node:internal/modules/esm/resolve:241:11)
    at moduleResolve (node:internal/modules/esm/resolve:846:10)
    at defaultResolve (node:internal/modules/esm/resolve:973:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:752:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:772:38)
    at nextStep (node:internal/modules/customization_hooks:189:26)
    at resolveBaseSync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:11092)
    at resolveDirectorySync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:12398)
    at resolveTsPathsSync (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:13605)
    at resolve (file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/register-nyXW-TH3.mjs:2:16832) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js'
}

Node.js v26.12.0
✖ test/team-server.test.ts (142.277875ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 146.302708

✖ failing tests:

test at test/team-server.test.ts:1:1
✖ test/team-server.test.ts (142.277875ms)
  'test failed'
```

## Manual implementation verification

After independent spec clearance, implemented src/team-server.ts and web/team.html/js. `pnpm exec tsx --test test/team-server.test.ts`: 9 tests pass. `pnpm exec tsc --noEmit` and `node --check web/team.js`: exit 0.

Test expectation alignment: private-pool member grant returns forbidden403; unrelated share revocation returns non-enumerating404. Host spoof test uses node:http because fetch replaces the supplied Host header. These are authorization outcomes, not weakened checks.

Attempted browser smoke via Playwright MCP failed before navigation because its shared browser profile was already in use. No browser verification claimed from that attempt. Parent integration owns independent review/build/browser proof. Formal Nightshift remains blocked; these are separate manual results.

## Isolated browser runtime proof

The earlier shared-profile block was bypassed safely using a new Playwright-launched headless Chrome process, without touching the shared browser. `pnpm exec tsx --test test/team-browser.test.ts` passed 1/1 in 3.34 seconds. The test drove creator sign-in, pool creation, two memory saves, selection/export, curated sharing, independent recipient browser read/download, revocation returning401, and logout. It asserts selected-only content, no creator/operator credentials in downloads and inert script-like memory text.

The first run reached revocation successfully but expected a different error string. The final assertion checks actual HTTP401 and the sign-in state instead of coupling security proof to wording. Operator revoke endpoint now has positive/negative HTTP coverage in the nine passing server tests.

Browser executable: local installed Google Chrome via Playwright 1.65.0. Fresh browser process and contexts; synthetic in-memory databases; no live data or deployment. See CREATOR-GUIDE.md for exact reproduction and limits.

Additional browser verification: private capture override creates a private destination and leaves the shared pool's memory count unchanged. Expanded browser flow passed again (3.49 seconds). Save/load actions disable buttons while pending to avoid dropping a user's click during another request. Team default policy messaging now reflects the owner-only, pool-wide core implementation; repository/conversation overrides remain personal.

## CLI integration QA and selected-pool repair

Added test/team-cli.test.ts using real CLI child processes against an ephemeral real TeamServer, temporary homes and synthetic records. Six tests pass: saved connection permissions/no token stdout; metadata/vector search/selected export/unpack provenance; disconnected private/off capture; offline queue plus committed-but-lost-response retry without duplication; policy target/off/private/account changes holding queued data; original policy file reread; watcher actual conversation policy and automatic-capture consent. Combined CLI/browser run passed 7/7 in 9.83 seconds.

The first integration run found sync failed on empty pools after reporting a held queue: export with no selected IDs returned400. Root fixed sync to report pulled0 without empty export; regression now passes. Independent review also found Create pool retained the previously selected destination. Creator UI now selects the returned pool ID; expanded browser proof creates a private pool from an existing selection, saves there, and asserts the earlier shared pool remains unchanged.

## Import and continuous capture completion

Added team-import CLI command for existing selected Pensieve bundles: private imports remain local; off stores nothing; shared imports persist per-memory historical provenance in the durable queue and import it as unverified attribution while recording the authenticated destination contributor. Integration verifies offline enqueue, sync, repeated import idempotence and preserved IDs/source metadata.

Watcher now flushes its queue on every eligible poll, including polls with no new messages. The regression leaves the server offline for more than one poll, restores it without appending session data, and observes exactly one contribution. A changed-server credential regression starts a separate HTTP listener and confirms no request is sent without an explicit credential for that origin. Reader browser proof now verifies normal pool reading/download remains usable while write/share forms are hidden and share management is not requested.

Latest targeted run: CLI9/9 plus isolated browser1/1, all10 pass in15.17 seconds; TypeScript exit0. No live deployment or formal Nightshift gate claim.
