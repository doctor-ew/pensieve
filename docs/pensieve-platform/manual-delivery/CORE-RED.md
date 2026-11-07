# Core RED evidence

Status: implementation not begun; independent spec review pending. These are manual-delivery tests, not Nightshift gate evidence.

Command: `pnpm exec tsx --test test/policy.test.ts test/memory-record.test.ts test/team-store.test.ts`

Observed test failure: all three test modules fail because the proposed application modules do not exist. The shell recording wrapper then failed on a reserved zsh variable; this report preserves the captured test output rather than treating that wrapper as a test result.

```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/memory-record.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js'
}

Node.js v26.12.0
✖ test/memory-record.test.ts (148.582375ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/policy.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js'
}

Node.js v26.12.0
✖ test/policy.test.ts (145.496375ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/team-store.test.ts
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
✖ test/team-store.test.ts (145.183833ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 153.431291

✖ failing tests:

test at test/memory-record.test.ts:1:1
✖ test/memory-record.test.ts (148.582375ms)
  'test failed'

test at test/policy.test.ts:1:1
✖ test/policy.test.ts (145.496375ms)
  'test failed'

test at test/team-store.test.ts:1:1
✖ test/team-store.test.ts (145.183833ms)
  'test failed'

```

## Confirmed rerun

Same command returned exit 1.

```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/memory-record.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js'
}

Node.js v26.12.0
✖ test/memory-record.test.ts (129.221083ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/policy.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js'
}

Node.js v26.12.0
✖ test/policy.test.ts (127.23775ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/team-store.test.ts
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
✖ test/team-store.test.ts (126.934042ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 133.787834

✖ failing tests:

test at test/memory-record.test.ts:1:1
✖ test/memory-record.test.ts (129.221083ms)
  'test failed'

test at test/policy.test.ts:1:1
✖ test/policy.test.ts (127.23775ms)
  'test failed'

test at test/team-store.test.ts:1:1
✖ test/team-store.test.ts (126.934042ms)
  'test failed'

```

## Expanded provenance, share registry and external vector contracts

Tests still fail before implementation (exit 1).

```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/memory-record.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/memory-record.js'
}

Node.js v26.12.0
✖ test/memory-record.test.ts (128.585916ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/policy.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/policy.js'
}

Node.js v26.12.0
✖ test/policy.test.ts (126.610125ms)
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/team-store.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/team-store.test.ts
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
✖ test/team-store.test.ts (147.356541ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 153.967083

✖ failing tests:

test at test/memory-record.test.ts:1:1
✖ test/memory-record.test.ts (128.585916ms)
  'test failed'

test at test/policy.test.ts:1:1
✖ test/policy.test.ts (126.610125ms)
  'test failed'

test at test/team-store.test.ts:1:1
✖ test/team-store.test.ts (147.356541ms)
  'test failed'

```

## Azure adapter RED

Exit 1 before implementation.
```text
node:internal/modules/esm/resolve:241
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/azure-vectors.js' imported from /Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/test/azure-vectors.test.ts
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
  url: 'file:///Users/doctorew/shuttlebay/doctorews-laboratory/pensieve-worktrees/shared-memory-delivery/src/azure-vectors.js'
}

Node.js v26.12.0
✖ test/azure-vectors.test.ts (154.149542ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 158.375833

✖ failing tests:

test at test/azure-vectors.test.ts:1:1
✖ test/azure-vectors.test.ts (154.149542ms)
  'test failed'

```
