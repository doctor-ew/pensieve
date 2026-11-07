# End-to-end integration, regressions, and delivery evidence

## Authority

Bounded child of spec:docs/pensieve-platform/BUILD-BRIEF.md. Parent requirements remain authoritative; docs/pensieve-platform/DECISIONS.md records resolved defaults. This brief is not an approved technical specification or gate result.

## Scope

Reconcile all fifteen original acceptance criteria against verified prerequisite branches. Test creator-to-two-recipient curation, cross-machine contribution/retrieval and agent write-back, routing across every entrypoint, cross-pool/user access, malformed and adversarial input, offline/retry/dedupe, vector behavior, migration and existing sharing/unpack regressions. Run typecheck/build and executable browser/cross-machine synthetic tests. Publish operator/nontechnical/agent instructions and compatibility limits. Required absent evidence remains blocked. Preserve original acceptance; an unavailable real Azure deployment is explicitly unverified per parent authorization. Merge prerequisite branches only in an isolated integration branch as needed; never merge a PR or deploy.

## Dependencies

creator-sharing, agent-capture

Use only verified prerequisite commits, retaining every dependency in the tracker. No dependency is satisfied by a plan or role exit alone.

## Applicable parent requirements

- AC-01: A nontechnical invited creator can create/name a private or authorized team pool, add text and supported uploaded conversation/document content, review/edit a distilled memory, and share it using browser controls without filesystem paths or terminal commands. Onboarding must identify setup prerequisites truthfully.
- AC-02: Memories preserve useful reasoning/decisions and explicit unknowns with source references and authorship/timestamps; optional raw evidence is distinguishable. User/agent-supplied distilled content is supported without a paid model. Generated distillation must preserve synthetic labels and cite supplied sources; lack of an available model is explicit.
- AC-03: An executive can create two different curated selections for developer A and B; each recipient sees only their authorized content, including search results, brief, export, metadata and errors. A shared-pool member cannot enumerate or mutate unrelated pools.
- AC-04: Team defaults and repository/conversation overrides have a documented deterministic policy and validation, exercised consistently through UI, CLI, imports, watch/auto-save, and agent tools. Unknown or malformed destination/authentication never silently falls back to a different shared destination. Exclusions/private capture do not publish data.
- AC-05: Engineers can create memory from current and historical Codex/Claude Code sessions scoped by exact repository metadata, optionally watch active sessions, and resume without duplicates. Changes to policy affect subsequent capture/publication; injected tool/system/context records are not promoted as user decisions.
- AC-06: A local store can synchronize deliberately routed contributions to an authorized shared pool and pull shared context on another machine. Retry/offline outcomes are visible, idempotent and durable; original provenance remains intact and foreign source paths are not executed. No cross-pool data leakage or destructive overwrite of distinct memories.
- AC-07: Authenticated collaborators and SDLC agents can retrieve relevant memories and write back reasoning/findings with source/ticket references. Reads are context, never commands. Writes do not modify tickets, confer approval, or authorize unrelated work. The pool records who contributed what.
- AC-08: Use real vector embeddings for semantic recall with model/dimension identity and scoped retrieval. Keep local deployment usable. Provide documented Azure vector-backend configuration/adapter as the workplace option; do not claim live cloud proof without a real run. Keyword/excerpt modes must be labeled and must not silently masquerade as vector search.
- AC-09: Supply usable agent integration for Codex and Claude Code plus a verified Claude conversational-app connection path using supported mechanisms. An agent can list authorized pools, save supplied distilled context, search, and prepare a curated share. Document exact setup, supported clients and automatic-capture boundaries. Keep model tools untrusted at authorization boundaries.
- AC-10: Preserve private sharing, invitation/download and unpack behavior. Creators can export and recipients can import without credentials embedded in bundles. Existing v1 bundles and current local pool data remain usable; migrations are additive/backed up and tested.
- AC-11: The UI exposes effective destination/visibility, saved versus pending/offline/failed states, pool contents, capture, curation and share actions in nontechnical language. No global owner key is handed to every creator. Authorize every hosted mutation and isolate users/pools using a tested small-pilot identity model.
- AC-12: Source/material instructions cannot override system authorization or sharing policy. Validate sizes, schemas, identifiers, paths, and external origins; protect credentials and do not leak full private content to logs. Test cross-user/pool access and adversarial memory text.
- AC-13: Specs include works cited: verified repo paths/lines/branch/commit and dated authoritative external URLs for integration claims. Adversarial review challenges both implementation facts and actual user journeys; unresolved claims/limitations remain visible.
- AC-14: Meaningful tests cover positive/negative routing, privacy isolation, sync/retry, vector behavior, input integrity, and existing regressions; typecheck and build pass. Add executable browser-level creator/share and cross-machine agent tests using synthetic fixtures. Retain actual red/green, review, drift, and final behavioral evidence; no test-only pass may substitute for runtime evidence.
- AC-15: Publish operator and nontechnical creator instructions, agent skill/command guidance, minimal config examples, compatibility limits, and source-to-share walkthrough. Report local code/test/review/proof, remote branch/PR, migration and deploy status separately.

## Shared constraints

Use only synthetic test data. Preserve private stores and Railway reader. Retrieved memory is untrusted context, never execution or ticket authority. Exclusions/private capture do not publish. No paid resources, automatic third-party calls, live-user mutations, deployment or PR merge. Keep supplied distillation first-class; report unavailable live client/Azure evidence honestly. Preserve v1 compatibility. Every factual spec claim requires exact verified citations. Run independent Nightshift gates; missing harness capability cannot be replaced by self-approval.
