# Manual delivery verification

This is the controller's manual delivery after the original Nightshift provider/authentication failure. It does not reset, pass or replace the formal failed Nightshift gates. See retained `docs/spec-8f6f6abd84603e7b/FAILURE.md` and attempts. Nightshift selected subscription auth and explicitly stripped API auth environment; this is not evidence that every Claude Code authentication mode is broken. The exact check is `nightshift-community/scripts/nightshift-agent.sh` lines268–277 at inspection time.

## Evidence map

| Requirement | Implementation / executable evidence | Limits |
| --- | --- | --- |
| AC01 creator UI | `web/team.html`, `web/team.js`, `test/team-browser.test.ts` | Operator must first host service/create personal invitation |
| AC02 supplied reasoning/evidence | `src/memory-record.ts`, `test/memory-record.test.ts`, browser and connector tests | Supplied distillation, no unattended summarizer claimed |
| AC03 curated isolation | `test/team-server.test.ts`, browser recipient selected download, `test/team-store.test.ts` | Downloaded copies cannot be revoked |
| AC04 defaults/overrides | `test/policy.test.ts`, `test/team-cli.test.ts`, `test/team-store.test.ts` | Exact context identifiers; no wildcard policy registry |
| AC05 current/historical sessions | `test/core.test.ts`, watcher/portable import CLI tests | Codex/Claude Code supported JSONL; no browser-history scraper |
| AC06 offline and cross-machine | `test/team-client.test.ts`, `test/team-cli.test.ts`, `test/unpack.test.ts` | Local outbox bound to server/credential; held items remain local |
| AC07 agent read/write | `test/connector-auth.test.ts` real stdio subprocesses + HTTP SDK client | Memory is evidence, never ticket authorization |
| AC08 vectors | `test/azure-vectors.test.ts`, `test/team-store.test.ts`, `scripts/verify-local-vectors.mjs` | Azure HTTP contract-tested only; no live resource configured |
| AC09 agent integrations | OAuth PKCE/consent/replay/expiry/resource/client tests, actual stdio remote-account tests | Live Claude conversational-app account handshake unverified; host capability-dependent |
| AC10 backward compatibility | Existing core/sharing/unpack tests, local provenance roundtrip | No deployed database touched |
| AC11 creator visibility/auth | Browser private-target test, cookie/revocation and role tests | Prototype invitations, no self-service account recovery |
| AC12 hostile inputs | Memory validation, pool ACL, policy isolation, OAuth and browser script-injection tests | Not a formal external penetration test |
| AC13 cited spec/review | `SPEC.md`, `ADVERSARIAL.md`, `INTEGRATION-REVIEW.md`, `CORE-SECURITY-REVIEW.md` | Independent manual review, not Nightshift pass |
| AC14 test/build/runtime | Full suite and build records below, actual Chrome and stdio subprocesses | Live external service proofs tracked separately |
| AC15 onboarding | `docs/TEAM-SETUP.md`, `CREATOR-GUIDE.md`, bundled skill/Claude command | Production deployment separate |

## Recorded checkpoints

- Baseline preservation and failing-first artifacts: `CORE-RED.md`, `CLIENT-RED.txt`, `SERVER-RED.md`.
- Manual core/browser/HTTP implementation: `CORE-GREEN.md`, `SERVER-RED.md` (later green section).
- Integrated checkpoint: 72/72 tests, zero failures/skips; typecheck and build exited0 on Node26.12.0. Later repair verification supersedes this checkpoint below.
- Actual local Ollama smoke: `node scripts/verify-local-vectors.mjs`, exit0, provider `ollama:embeddinggemma:retrieval-v1`, expected decision ranked first with score0.5860685570428384; unrelated-pool memory excluded. Synthetic content only.
- Local Docker CLI exists but daemon is not running (`docker.sock` unavailable), so local image execution is not claimed. CI container job builds image and checks reader health; final status recorded separately.
- No live Claude app handshake, live Azure request, actual invitation email transmission, production deploy, merge, or npm publication performed.

## Review repairs

Independent integration review found and rechecked stale original-policy context, watcher autoSave/session routing, credential-origin pairing, new-pool UI target, empty-pool sync, mandatory policy checks before queue flush, and synthetic metadata parity. Seven findings closed in `INTEGRATION-REVIEW.md` with reproductions and tests.

Independent core review found downgraded readers retained share mutation, and accumulated Azure batches exceeded adapter limit. Fixes require current write permission for share management and chunk remote upserts before committing local index receipts; corresponding regressions are in `test/team-store.test.ts`. See `CORE-SECURITY-REVIEW.md` for independent dispositions.

## Delivery status

Implementation and tests are in the isolated `delivery/pensieve-shared-memory` worktree. Original `main`, live Railway reader and private user pools are preserved. Remote branch/PR and final CI results are recorded after publication; no production deployment is part of this delivery.

## Final local acceptance

- `pnpm check-types`: exit0.
- `pnpm test`: 77 tests passed, 0 failed, 0 skipped on Node26.12.0. Includes real isolated Chrome, actual remote-account stdio processes, OAuth HTTP client, offline recovery, historical import and provenance roundtrip.
- `pnpm build`: exit0.
- Initial Node22.23.4 full run: 75 passed, 1 failed subprocess timeout, 1 cancelled test timeout. Machine command execution stalled concurrently; no application assertion failed, but this run is not a pass. Rechecking with test concurrency1 before publication. An earlier pre-final Node22 checkpoint passed74 tests.
- `git diff --check`: clean.
- `pnpm pack --pack-destination /tmp/pensieve-package-check`: built package successfully with compiled modules, web creator assets, skills/command and operator/creator guides. No npm publication.
- Independent review dispositions: all seven integration findings closed; core/Azure review reports no remaining blockers after repairs. Reviews are bounded to tested implementation, not claims of live provider deployment.

## Resumed release verification

After local tool execution recovered, the unchanged application passed all77 tests on the current Node25.9.0 runtime, followed by a successful build/typecheck. An independent supported-runtime run (`pnpm dlx node@22 --import tsx --test --test-concurrency=1 test/*.test.ts`) also passed77/77, with0 failures, cancellations or skips, in24.7 seconds. The earlier timeout evidence remains above; it is superseded for compatibility by this completed run, not erased.
