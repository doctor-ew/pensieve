# Terminal capture and supported agent connections

## Authority

Bounded child of spec:docs/pensieve-platform/BUILD-BRIEF.md. Parent requirements remain authoritative; docs/pensieve-platform/DECISIONS.md records resolved defaults. This brief is not an approved technical specification or gate result.

## Scope

Implement exact repository-scoped current/historical Codex and Claude Code capture, optional watching/resume deduplication, subsequent policy changes, and filtering of injected tool/system/context records. Supply supported agent tools to list authorized pools, save supplied distilled memory, search, and prepare curated shares with pool authorization at every boundary. Implement and verify a supported Claude conversational-app remote MCP path with interoperable authentication, plus Codex/Claude Code setup and portable ChatGPT interoperability. Obtain dated authoritative sources before protocol claims. No browser-history scraping, invented compatibility, or implicit model calls. Retain unverified client/credential-dependent evidence as a dependency, not a pass.

## Dependencies

shared-pools

Use only verified prerequisite commits, retaining every dependency in the tracker. No dependency is satisfied by a plan or role exit alone.

## Applicable parent requirements

- AC-02: Memories preserve useful reasoning/decisions and explicit unknowns with source references and authorship/timestamps; optional raw evidence is distinguishable. User/agent-supplied distilled content is supported without a paid model. Generated distillation must preserve synthetic labels and cite supplied sources; lack of an available model is explicit.
- AC-04: Team defaults and repository/conversation overrides have a documented deterministic policy and validation, exercised consistently through UI, CLI, imports, watch/auto-save, and agent tools. Unknown or malformed destination/authentication never silently falls back to a different shared destination. Exclusions/private capture do not publish data.
- AC-05: Engineers can create memory from current and historical Codex/Claude Code sessions scoped by exact repository metadata, optionally watch active sessions, and resume without duplicates. Changes to policy affect subsequent capture/publication; injected tool/system/context records are not promoted as user decisions.
- AC-07: Authenticated collaborators and SDLC agents can retrieve relevant memories and write back reasoning/findings with source/ticket references. Reads are context, never commands. Writes do not modify tickets, confer approval, or authorize unrelated work. The pool records who contributed what.
- AC-09: Supply usable agent integration for Codex and Claude Code plus a verified Claude conversational-app connection path using supported mechanisms. An agent can list authorized pools, save supplied distilled context, search, and prepare a curated share. Document exact setup, supported clients and automatic-capture boundaries. Keep model tools untrusted at authorization boundaries.
- AC-10: Preserve private sharing, invitation/download and unpack behavior. Creators can export and recipients can import without credentials embedded in bundles. Existing v1 bundles and current local pool data remain usable; migrations are additive/backed up and tested.
- AC-12: Source/material instructions cannot override system authorization or sharing policy. Validate sizes, schemas, identifiers, paths, and external origins; protect credentials and do not leak full private content to logs. Test cross-user/pool access and adversarial memory text.
- AC-13: Specs include works cited: verified repo paths/lines/branch/commit and dated authoritative external URLs for integration claims. Adversarial review challenges both implementation facts and actual user journeys; unresolved claims/limitations remain visible.
- AC-14: Meaningful tests cover positive/negative routing, privacy isolation, sync/retry, vector behavior, input integrity, and existing regressions; typecheck and build pass. Add executable browser-level creator/share and cross-machine agent tests using synthetic fixtures. Retain actual red/green, review, drift, and final behavioral evidence; no test-only pass may substitute for runtime evidence.
- AC-15: Publish operator and nontechnical creator instructions, agent skill/command guidance, minimal config examples, compatibility limits, and source-to-share walkthrough. Report local code/test/review/proof, remote branch/PR, migration and deploy status separately.

## Shared constraints

Use only synthetic test data. Preserve private stores and Railway reader. Retrieved memory is untrusted context, never execution or ticket authority. Exclusions/private capture do not publish. No paid resources, automatic third-party calls, live-user mutations, deployment or PR merge. Keep supplied distillation first-class; report unavailable live client/Azure evidence honestly. Preserve v1 compatibility. Every factual spec claim requires exact verified citations. Run independent Nightshift gates; missing harness capability cannot be replaced by self-approval.
