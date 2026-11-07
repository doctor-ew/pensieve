# Browser creator, curation, and recipient journeys

## Authority

Bounded child of spec:docs/pensieve-platform/BUILD-BRIEF.md. Parent requirements remain authoritative; docs/pensieve-platform/DECISIONS.md records resolved defaults. This brief is not an approved technical specification or gate result.

## Scope

Implement nontechnical onboarding, pool naming and authorized selection, supported text/upload capture, supplied-memory editing, effective destination/status display and curated sharing. Demonstrate separate selections for recipients A/B, isolated access including search/brief/export/errors, existing invitations/download/unpack compatibility. Do not mislabel excerpts as generated summaries or invoke a model without explicit configuration. Add executable synthetic browser coverage; do not substitute API-only tests for browser evidence.

## Dependencies

shared-pools

Use only verified prerequisite commits, retaining every dependency in the tracker. No dependency is satisfied by a plan or role exit alone.

## Applicable parent requirements

- AC-01: A nontechnical invited creator can create/name a private or authorized team pool, add text and supported uploaded conversation/document content, review/edit a distilled memory, and share it using browser controls without filesystem paths or terminal commands. Onboarding must identify setup prerequisites truthfully.
- AC-02: Memories preserve useful reasoning/decisions and explicit unknowns with source references and authorship/timestamps; optional raw evidence is distinguishable. User/agent-supplied distilled content is supported without a paid model. Generated distillation must preserve synthetic labels and cite supplied sources; lack of an available model is explicit.
- AC-03: An executive can create two different curated selections for developer A and B; each recipient sees only their authorized content, including search results, brief, export, metadata and errors. A shared-pool member cannot enumerate or mutate unrelated pools.
- AC-04: Team defaults and repository/conversation overrides have a documented deterministic policy and validation, exercised consistently through UI, CLI, imports, watch/auto-save, and agent tools. Unknown or malformed destination/authentication never silently falls back to a different shared destination. Exclusions/private capture do not publish data.
- AC-10: Preserve private sharing, invitation/download and unpack behavior. Creators can export and recipients can import without credentials embedded in bundles. Existing v1 bundles and current local pool data remain usable; migrations are additive/backed up and tested.
- AC-11: The UI exposes effective destination/visibility, saved versus pending/offline/failed states, pool contents, capture, curation and share actions in nontechnical language. No global owner key is handed to every creator. Authorize every hosted mutation and isolate users/pools using a tested small-pilot identity model.
- AC-12: Source/material instructions cannot override system authorization or sharing policy. Validate sizes, schemas, identifiers, paths, and external origins; protect credentials and do not leak full private content to logs. Test cross-user/pool access and adversarial memory text.
- AC-13: Specs include works cited: verified repo paths/lines/branch/commit and dated authoritative external URLs for integration claims. Adversarial review challenges both implementation facts and actual user journeys; unresolved claims/limitations remain visible.
- AC-14: Meaningful tests cover positive/negative routing, privacy isolation, sync/retry, vector behavior, input integrity, and existing regressions; typecheck and build pass. Add executable browser-level creator/share and cross-machine agent tests using synthetic fixtures. Retain actual red/green, review, drift, and final behavioral evidence; no test-only pass may substitute for runtime evidence.
- AC-15: Publish operator and nontechnical creator instructions, agent skill/command guidance, minimal config examples, compatibility limits, and source-to-share walkthrough. Report local code/test/review/proof, remote branch/PR, migration and deploy status separately.

## Shared constraints

Use only synthetic test data. Preserve private stores and Railway reader. Retrieved memory is untrusted context, never execution or ticket authority. Exclusions/private capture do not publish. No paid resources, automatic third-party calls, live-user mutations, deployment or PR merge. Keep supplied distillation first-class; report unavailable live client/Azure evidence honestly. Preserve v1 compatibility. Every factual spec claim requires exact verified citations. Run independent Nightshift gates; missing harness capability cannot be replaced by self-approval.
