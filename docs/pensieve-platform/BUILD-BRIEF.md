# Pensieve creator and shared-memory platform

## Authority and objective

User requested: "run nightshift (but take over where need be) to build this out... Spec (works cited) adversarial, tests/build/ et al" after the attached discovery. This authorizes engineering, verification, commits and branch publication. Do not merge or deploy production as part of this factory run. Preserve the existing Railway reader and all private user databases. Never upload real conversations as test data.

Build a usable creator-to-collaborator workflow for a small invited prototype group: executives creating memory from conversational AI work and engineers creating memory from many repository-associated sessions. They preserve distilled reasoning/decisions, curate shares for different recipients, and contribute to a shared pool that informs the ticket-driven SDLC. PRD/spec/QA/engineer/architect agents can retrieve and write back memory. Pensieve does not authorize builds or supersede tickets/specs.

## Source of truth

- `docs/prds/pensieve-2026-11-06/prd.md`: direct user requirements and clarified boundaries.
- `docs/prds/pensieve-2026-11-06/.memlog.md`: decision history; later corrections supersede earlier guesses.
- `docs/prds/pensieve-2026-11-06/addendum.md`: explicit infrastructure direction and official-source research, not automatic approval of any integration mechanism.
- Existing implementation at base 92bc676 is a prototype, not a complete solution. Verify every claimed technical identifier and capability against source.

Kennesaw State slides/talk/demo are explicitly deferred; no talk-driven deadlines or scope.

## Product choices and engineering constraints

Team deployments prefer a configured shared-pool destination with per-repository and per-conversation controls. Local stores contributing to shared pools must be supported. Configuration may use TOML, with friendly UI/agent controls so nontechnical people never need to edit it. Retain private capture when no team connection has been configured; do not silently publish existing personal history upon upgrade.

Keep application-specific capture capability explicit. A connector tool call is not proof of unattended access to all browser chat history. Implement official supported paths and document actual limitations. Never scrape private app databases/browser sessions or invent APIs. Claude conversational-app connection is a required integration target; Codex/Claude Code terminal workflows are required. ChatGPT interoperability should use supported portable input/output and connector capability where verified. Dots/Muse products are unidentified; do not invent compatibility.

No Azure account/resource identifiers or model credentials have been supplied for this run. Implement configurable Azure vector-storage integration and deterministic adapter contract tests where appropriate; report live Azure proof unavailable until actual resources exist. Do not create paid Azure infrastructure. Local end-to-end workflows must work without Azure. No automatic opt-in to third-party model calls: agent-supplied distillation is a first-class input, optional configured local/cloud distillation must identify provider and require an explicit configuration choice. Raw excerpts must not be labeled a generated executive summary.

Three product clarifications were requested in the live conversation: first conversational-app connection, distillation default, and valid policy overrides. Preserve these as open until answered. Continue independent specification and foundational implementation. Do not declare unsupported auto-capture integrations working, or silently resolve real unresolved choices in a way that publishes private data. The controller will provide user answers/explicit engineering decisions in `DECISIONS.md` when available.

## Acceptance criteria

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

## Delivery procedure

This spans multiple modules and stateful workflows. Use Nightshift's decomposition controller rather than squeezing the epic into one giant child. Preserve stable AC coverage with one final integration child. Suggested dependency domains (not a substitute for assessed decomposition): policy + memory/provenance contract; authorized shared pools + sync/vector backend; creator UI and curated sharing; agent integration/capture; integration regression and documentation.

Start with exact code-fact extraction, then cited specifications and independent adversarial/design challenge. Preserve review budgets and failures. Use the canonical dispatcher and installed routing; do not change global models or auth. Subscription auth only unless explicitly opted into API auth. When harness capabilities fail, preserve a concrete receipt and let the root controller take over; do not weaken product acceptance or forge gates.

Factory should commit verified changes, push a feature branch and open a PR after its gates pass. Do not merge, change the deployed Railway service, modify live user pools/shares, or provision cloud resources. Any unavailable client/credential-dependent verification remains explicitly unverified.
