# Hosted agent verification — 2026-11-06

Host: https://pensieve-team-production.up.railway.app

Runtime commit: b614dfe. Railway deployment 8eb3c0db-933d-4f2a-a0f0-591d4850a7b3 reported SUCCESS; public health endpoint returned status ok.

Actual official SDK stdio subprocess against Railway passed list tools, save_memory, index_memories, and semantic recall of a synthetic SQLite/offline decision using a differently worded query. The synthetic verification account was revoked afterward. Drew's configured personal client separately passed list_pools and exposed all five tools. No real historical sessions were uploaded for verification. An early smoke during rollout hit the previous deployment and returned indexing 400; the completed deployment passed.

CPU embeddings use pinned quantized MiniLM, 384 dimensions. Public model assets are downloaded once and cached on the data volume. Memory text is embedded in the Railway process. Local real-model smoke also confirmed pool isolation. Typecheck/build and 78 existing tests passed; one additional provider validation test passed. Production dependency audit reported no known vulnerabilities.

Both Claude Code (user scope) and Codex (global) have a stdio MCP registration pointing to the built railway-team-live worktree, with a separate private connected client home. Claude reported Connected. CLI launcher and installed skill/command were updated with backups under the private client setup-backup directory. A new shared Hack-Her-Thon pool is empty and ready for deliberate captures; it does not contain the older local history.

## Start using it

Open a new Claude Code or Codex session and ask:

> Use Pensieve to list my pools. Save a concise summary of the decisions we made in this conversation to Hack-Her-Thon, preserving rationale, source references and open questions. Index the saved memories.

In a later session:

> Recall the relevant Hack-Her-Thon memories from Pensieve before proposing changes. Cite the memories and flag conflicts with the current ticket or repository.

For sharing, use the creator UI to select memories and create a recipient link. prepare_share returns a selected bundle; it does not send an email.

## Remaining limits

Claude/ChatGPT browser-app custom connectors have not been connected or exercised. Chrome automation failed before account settings with missing codex app-server; no account UI changes were made. The remote OAuth endpoint is /mcp, but host-specific setup remains pending. There is no automatic access to unsupplied browser conversations.

Terminal registrations and launcher currently depend on the preserved railway-team-live worktree. This is a local installation, not a published npm release. PR #5 remains separate from the live deployment and must be merged to include these changes on main.
