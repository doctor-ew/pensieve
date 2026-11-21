# Full MEX integration into Pensieve — discovery and scope

Historical discovery snapshot. Superseded by SPEC.md and OPERATIONS.md after the user clarified shared vector-memory retrieval. The three choices below have been answered; the broad Hub/workflow reconstruction and hosted graph-worker proposal are not the current release scope.

## Verified baseline

MEX checkout: `/Users/doctorew/shuttlebay/mex`, commit `e5d4b93c84f09b946edc890859c7479700c2ee52`, package `mex-agent@0.9.0-beta.1.1`. Current code and README supersede historical 0.8 installation notes.

The graph engine is implemented in `src/graph/engine-impl.ts`; graph maintenance runs through an isolated candidate process (`src/graph/cli-graph.ts:18`). The package-root compatibility contract (`src/index.ts:1`) does not export the graph engine. Integration must use a pinned, tested CLI adapter or establish an intentional supported library surface; do not silently rely on private module imports.

Pensieve currently runs API and worker Lambdas on arm64 with512MB memory and29/120-second timeouts (`infra/aws-serverless/compute.tf:11`). Full graph extraction needs workload measurement and a separate bounded job execution design before selecting its AWS runtime. The existing request handler must not synchronously build graphs.

## Required capability coverage

| Capability | Existing MEX source | Pensieve integration requirement |
|---|---|---|
| Graph build, refresh, repair, freshness | `src/graph/cli-graph.ts`, `src/graph/maintenance.ts` | Versioned repository snapshots; asynchronous jobs; atomic publication; explicit failure and stale states |
| Definitions, callers, callees, scope, impact | `src/cli.ts:573`, `src/cli.ts:970`, `src/graph/application-adapter.ts` | Authorized query interfaces, bounded traversal, commit-specific evidence |
| Grounded notes and recall | `README.md:94`, `src/wiki/` | Notes retain code groundings and lifecycle; integrate with Pensieve pools rather than flattening into unchecked text |
| Stale-note filtering, checks, drift | `README.md:68`, `src/drift/`, `src/graph/grounding.ts` | Serve current verified evidence and explicitly identify withheld/changed groundings |
| Note edit, correction, retirement, handoff | `README.md:94` | Preserve provenance, history, authorization and existing team review boundaries |
| Session context and hooks | `README.md:85`, `src/hooks/`, `src/install/` | Per-repository opt-in; integrate existing Codex/Claude setups; restore prior settings on disable/uninstall |
| Web experience | `packages/hub-web/`, `src/hub/jobs/graph.ts` | Pensieve-owned repository, job, graph and grounded-note workflows using Pensieve identity and pool access |
| Remote MCP | Pensieve `src/agent-server.ts` | Remote graph and grounded-note tools; never assume remote agents can read a workstation |
| Repository acquisition and updates | User choice pending | Explicit source registration, pinned revisions, credentials isolation, bounded ingestion, retryable updates |

MEX README marks some future 0.9 features as upcoming (`README.md:194`). Do not claim these as available solely because they appear on the roadmap. Verify each exposed capability against executable code and fixtures.

## Implementation gates

1. Resolve the three product choices, define the supported repository and host matrix, and freeze acceptance criteria for all capabilities above.
2. Prove the pinned engine adapter on a synthetic multi-file fixture: build, definitions, caller/callee traversal, impact, grounded-note change detection, and restart persistence.
3. Measure runtime/artifact requirements and implement isolated AWS graph jobs, durable artifacts, account/pool ownership, cancellation and job receipts.
4. Implement remote API/MCP and Pensieve web flows with authorization tests for every operation. Preserve current memory and repository-context compatibility.
5. Implement chosen intake/refresh mechanisms and opt-in local hooks; verify disable/uninstall behavior and no unintended source publication.
6. Run cross-account isolation, malicious repository containment, no-repository-code-execution, replay/idempotency, stale revision, and failure-recovery tests.
7. Deploy through the reviewed AWS workflow. If new infrastructure is necessary, its Lambda-only apply guard must not be bypassed; prepare and review the actual infrastructure plan separately.
8. Verify from a remote agent, the web UI, and supported local agent sessions against the same authorized repository and revision. Record full versus unsupported capability coverage explicitly.

No source repositories have been uploaded, hooks installed, or additional infrastructure deployed during this investigation.
