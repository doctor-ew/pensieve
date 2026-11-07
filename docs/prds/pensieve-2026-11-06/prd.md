---
title: Pensieve — create and share AI working memory
status: draft
created: 2026-11-06
updated: 2026-11-06
---

# Pensieve product discovery

This is a discovery draft, not an approved implementation specification. The user subsequently authorized Nightshift specification, adversarial review, implementation, tests, and build. This discovery record remains historical; the implementation brief and verified specification resolve build scope. Existing code is context, not a constraint on the intended product.

## Confirmed direction

Source: direct user statements in the Pensieve product discussion, 2026-11-06.

- People must be able to CREATE and SHARE memories, not only consume someone else's published brief.
- Executives and nontechnical people already work in conversational AI applications. Claude's conversational app is explicitly relevant; ChatGPT is a potential source. The user also named Dots and Muse; exact products and desired workflows still need clarification.
- Engineers such as Drew work primarily in a terminal with many conversations associated with each repository.
- UI, agent skill, and terminal experiences are desired entry points. Their responsibilities and first-release priority are not yet decided.
- Pensieve is intended as an open-source project under Doctor Ew's Laboratory.
- The user wants to think through the product and write a PRD before further implementation.

## Desired outcomes and journey seeds

Source: user clarification during discovery, 2026-11-06. These are narrated goals; the interaction steps remain to be designed with the user.

### UJ-1: Executive idea handoff

An executive develops an idea in a conversational AI application. They want to show the idea to another executive or hand it to a colleague who can use or build it. Success means the recipient has enough of the reasoning and decisions to act on the idea. The user has not yet specified whether the recipient reads in Pensieve, continues in an AI application, or both.

### UJ-2: Preserve useful thinking

A creator wants to save useful work independently of continued access to the original conversation. The user expressed concern about conversations disappearing. A specific provider retention interval is not verified and is not a product premise. Whether preservation means only the distilled memory or also an optional original transcript remains open.

### UJ-3: Developer continuity and handoff

Drew wants to move project memory between personal and work laptops, and give or receive memories with another developer so work on a build can continue. Many conversations may belong to one repository. The user wants selective handoffs and supports separate copies, returning new thinking, and shared contribution; a shared pool is preferred. Selection boundaries and update rules remain open.

## Confirmed content preference

Distilled reasoning and decisions usually suffice. The product should not require recipients to read complete transcripts to benefit from a handoff. Full transcripts are not established as a default requirement. What constitutes a sufficient distillation still needs an example and review criteria.

## Creation and collaboration preferences

Source: direct user clarification during discovery, 2026-11-06.

- One executive/cofounder wants automatic saving so preservation does not depend on remembering a manual action.
- Another coworker wants to curate what is shared, including natural-language requests such as “save the X memories” and “save the X conversations for dev A and the Y conversations for dev B.” These are desired interactions, not claims about existing integrations.
- The product should accommodate a recipient keeping their own copy, returning new thinking to the sender, and contributing to a shared pool. The shared-pool model is preferred.
- Local databases that later contribute to a shared pool are a possibility to evaluate, not a committed synchronization design.
- In a team setting, the user prefers a shared-pool default with configurable overrides at repository or conversation scope. Exact precedence, available override values, and routing behavior remain to be defined. TOML was suggested as a possible configuration format, not a required user interface.

## Audience and delivery context

- **Current prototype:** Drew and a few people he shares with. This is an exploratory prototype, not a general public launch.
- **Workplace pilot:** Executives at Drew's work and a few engineers. The user identified an Azure-hosted vector database as the intended workplace infrastructure direction; service selection and deployment are outside this PRD discovery step.
- The repository remains intended as open source; public self-service onboarding is not established as a first-release requirement.

## Role in the SDLC

Pensieve manages memory that informs PRD, specification, QA, engineering, and architecture agents. Tickets and the existing SDLC retain responsibility for authorizing and governing build work. Reading a memory, contributing to a pool, or recording a decision does not itself approve a ticket, change scope, or authorize implementation.

The user expects SDLC agents to write their useful findings and reasoning back to the pool. The previous discovery question about Pensieve approving which decisions become authoritative misplaced responsibility; Pensieve is not a replacement ticketing system or approval workflow. How retrieved material expresses its source, date, and status still requires definition so agents can interpret it correctly.

## Open product questions for later discovery

- Capture: which exact source applications/account types must support automatic saving, and which can initially use explicit capture?
- Distillation: can Pensieve use a separately configured approved model, or must it operate within the creator's current AI application/session?
- Routing: what values can repository/conversation overrides select, and what happens when settings conflict or no destination is available?

## Deferred context

The Kennesaw State talk will use slides, with a possible demo. At the user's explicit direction, it is parked and must not drive product scope, prioritization, acceptance criteria, or deadlines. Revisit only when the user brings it back into scope.

## Not decided

- The unit of memory and how people name/select it across conversations and repositories.
- Exact source applications, account types, available integrations, and installation/setup tolerance.
- Team/repository/conversation policy precedence, destinations, preview/exclusion behavior, and how nontechnical users inspect or change settings.
- Ownership, recipient permissions, shared contribution rules, revision history, and how memory references existing ticket/spec status without replacing those systems.
- Local storage, offline work, synchronization timing, conflict handling, and work/personal separation.
- Raw transcript retention, memory deletion, share expiry, and downloaded-copy expectations.
- How to recognize a useful and faithful distillation; fidelity checks and measurable pilot success.
- Which source materials beyond this discussion should inform discovery.

## Requirements and acceptance criteria

### Initial functional requirements

These requirements reflect stated outcomes; they are not a frozen implementation scope.

- FR-1: A creator can preserve useful thinking from their AI work as a memory they can access independently of the source conversation. Retention duration and storage location are undecided.
- FR-2: A creator can share a memory to present an idea or enable a colleague to use or build it.
- FR-3: A developer can transfer project memories between machines and exchange them with another developer to support continued build work.
- FR-4: Distilled reasoning and decisions are the default intended content for a handoff; complete transcripts are not required for ordinary consumption.
- FR-5: Support automatic saving for a creator who does not want to perform a manual save after each useful conversation. Eligible sources, scope, destination, and failure visibility require definition.
- FR-6: A creator can select memories or conversations for different named recipients, including different selections for developer A and developer B. Natural-language selection is a desired interaction.
- FR-7: Support a shared pool that collaborators can build on. Contribution permissions and memory revision/provenance behavior remain open; SDLC authorization remains with the existing ticket-driven process.
- FR-8: Support handoffs where recipients retain an independent copy or return new thinking to the sender, alongside the preferred shared-pool mode. Exact interaction and merge rules remain open.
- FR-9: Support a configurable team default that routes saved memory to a shared pool, with repository- and conversation-scoped overrides. Policy precedence and valid override values require confirmation.
- FR-10: PRD/specification, QA, engineering, and architecture agents can retrieve relevant memory as context for their existing SDLC tasks.
- FR-11: SDLC agents can contribute useful findings, reasoning, and decisions back to the appropriate memory pool.
- FR-12: Memory access and write-back do not themselves authorize implementation or replace ticket/spec/approval authority.

### Outcome checks to refine

These are discovery scenarios, not approved pass/fail criteria:

- An executive's useful work is preserved without a manual save each time.
- A coworker gives developer A the intended X context and developer B the intended Y context; the audience boundaries match the creator's selection.
- Drew resumes a repository's build work on another laptop using the distilled memory.
- An SDLC agent retrieves relevant context for its ticket-driven task and writes useful findings back to the designated pool. The memory does not grant new task authority or silently change the ticket/specification.

Acceptance criteria, capture mechanisms, access rules, and success measures are pending discovery. No infrastructure choice, integration promise, or current implementation is treated as an approved requirement.
