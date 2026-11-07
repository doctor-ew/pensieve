# Implementation context — not product decisions

The current prototype includes a local store, a hosted reader, explicit share creation, downloads, and repository unpacking. These are evidence of experiments, not a definition of the product's scope.

- Local creation and sharing: ../../../src/server.ts
- Hosted reader and download: ../../../src/share-server.ts
- Local unpack: ../../../src/unpack.ts
- Existing agent instructions: ../../../skills/pensieve/SKILL.md

The user previously preferred vector-based memory. Storage engines, retrieval algorithms, hosting, authentication mechanisms, and integrations belong in subsequent architecture decisions after discovery establishes the required behaviors.

## User-supplied infrastructure direction

For the workplace pilot, the user intends an Azure vector database. No Azure service, schema, network model, account configuration, or deployment has been chosen or authorized by the PRD discussion itself. This direction is distinct from the current prototype. Local databases contributing to a shared pool are a question to evaluate after capture/publishing and collaboration behavior are defined.

## Official-source feasibility notes — researched 2026-11-06

These facts inform later integration discovery; they do not define the product requirements or imply every account has the same capabilities.

- Claude supports account-data export, with organization controls for workplace accounts; exported data does not recreate a different Claude account. [Official export guide](https://support.claude.com/en/articles/9450526-export-your-claude-data)
- Claude accepts documents as chat attachments or project reference files. This establishes a context-document path, not automatic cross-application synchronization. [Official file guide](https://support.claude.com/en/articles/8241126-upload-files-to-claude)
- ChatGPT's export availability depends on account/workspace type. Conversation JSON can be used as reference in a new chat; it does not restore separate conversations, settings, or saved memories. [Export guide](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data), [Transfer limitations](https://help.openai.com/en/articles/9106926-transfer-exported-conversations-between-chatgpt-accounts)
- A universal 30-day expiry for ordinary saved Claude web chats was not established. The documented consumer deletion interval follows deletion; Claude Code separately documents a configurable local transcript cleanup interval with a 30-day default. Keep these product behaviors distinct. [Consumer retention](https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data), [Claude Code cleanup setting](https://code.claude.com/docs/en/settings-reference#cleanupperioddays)

The specific Dots and Muse products have not been identified. No claims about their export, connector, skill, or synchronization capabilities have been made.

## Configuration and agent participation — user direction

The user suggested a configuration file, possibly TOML, for a team shared-pool default with per-repository or per-conversation overrides. The PRD records configuration behavior; file format, configuration lookup, precedence implementation, secrets storage, and nontechnical controls remain architecture/UX decisions. No sample configuration is presented as an existing contract.

The user clarified that tickets govern build work. PRD/specification, QA, engineering, and architecture agents consume and write back memory as participants in the existing SDLC. Pensieve must not introduce a competing approval system.

Deferred at the user's explicit direction: the Kennesaw State presentation is approximately six days away and will use slides, with a possible demo. It is not the product focus and imposes no product deadline or required demonstration scope. Revisit only when the user brings it back into scope.
