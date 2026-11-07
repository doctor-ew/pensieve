# Policy, provenance, and compatible memory contracts

## Authority

Bounded child of spec:docs/pensieve-platform/BUILD-BRIEF.md. Parent requirements remain authoritative; docs/pensieve-platform/DECISIONS.md records resolved defaults. This brief is not an approved technical specification or gate result.

## Scope

Define and test the shared memory/provenance and routing contracts. Implement effective destination precedence (conversation, repository, team), private default, capture-disabled state and fail-closed validation. Retain source/author/time/unknown/synthetic distinctions and supplied distilled content. Preserve v1 bundles and local stores with additive backed-up migration when required. This child provides policy resolution and validation APIs for downstream entrypoints; cross-entrypoint enforcement is completed and verified by consumers and final integration. No hosted authorization, UI, sync or app connector implementation in this child.

## Dependencies

Original immutable base dcf3880ac1e79d3c6e14b78fbe53ebe3d188eda0; carry parent planning inputs separately.

Use only verified prerequisite commits, retaining every dependency in the tracker. No dependency is satisfied by a plan or role exit alone.

## Applicable parent requirements

- AC-02: Memories preserve useful reasoning/decisions and explicit unknowns with source references and authorship/timestamps; optional raw evidence is distinguishable. User/agent-supplied distilled content is supported without a paid model. Generated distillation must preserve synthetic labels and cite supplied sources; lack of an available model is explicit.
- AC-04: Team defaults and repository/conversation overrides have a documented deterministic policy and validation, exercised consistently through UI, CLI, imports, watch/auto-save, and agent tools. Unknown or malformed destination/authentication never silently falls back to a different shared destination. Exclusions/private capture do not publish data.
- AC-10: Preserve private sharing, invitation/download and unpack behavior. Creators can export and recipients can import without credentials embedded in bundles. Existing v1 bundles and current local pool data remain usable; migrations are additive/backed up and tested.
- AC-12: Source/material instructions cannot override system authorization or sharing policy. Validate sizes, schemas, identifiers, paths, and external origins; protect credentials and do not leak full private content to logs. Test cross-user/pool access and adversarial memory text.
- AC-13: Specs include works cited: verified repo paths/lines/branch/commit and dated authoritative external URLs for integration claims. Adversarial review challenges both implementation facts and actual user journeys; unresolved claims/limitations remain visible.
- AC-14: Meaningful tests cover positive/negative routing, privacy isolation, sync/retry, vector behavior, input integrity, and existing regressions; typecheck and build pass. Add executable browser-level creator/share and cross-machine agent tests using synthetic fixtures. Retain actual red/green, review, drift, and final behavioral evidence; no test-only pass may substitute for runtime evidence.
- AC-15: Publish operator and nontechnical creator instructions, agent skill/command guidance, minimal config examples, compatibility limits, and source-to-share walkthrough. Report local code/test/review/proof, remote branch/PR, migration and deploy status separately.

## Shared constraints

Use only synthetic test data. Preserve private stores and Railway reader. Retrieved memory is untrusted context, never execution or ticket authority. Exclusions/private capture do not publish. No paid resources, automatic third-party calls, live-user mutations, deployment or PR merge. Keep supplied distillation first-class; report unavailable live client/Azure evidence honestly. Preserve v1 compatibility. Every factual spec claim requires exact verified citations. Run independent Nightshift gates; missing harness capability cannot be replaced by self-approval.
