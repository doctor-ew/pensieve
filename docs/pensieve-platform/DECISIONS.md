# Root controller implementation decisions

These are explicit reversible engineering decisions by the root controller under the user's instruction to build and take over where needed. They are not claimed to be new user answers. Keep configuration extensible and retain the product discovery record.

1. Implement verified Claude conversational-app remote MCP connection plus Codex/Claude Code terminal paths first. ChatGPT portable context interoperability is required; do not promise unverified account-specific app access. Browser-wide unattended history scraping is excluded. Automatic terminal capture and repeated agent write-back are supported with truthful client capability documentation.
2. Default to user/current-agent-supplied distilled memories. An optional explicitly configured model may provide distillation; do not call it without configured consent and supported provider. This permits all deployment choices without silently exporting conversations.
3. Effective routing is conversation override, then repository override, then team default. Valid routes are configured shared pool, private/local, and capture disabled. An unconfigured installation remains local/private. Malformed config or missing authorized pool is an error/pending state, never a fallback to another pool. Local-to-shared contributions are additive/idempotent, not destructive replacement.
4. Invite-only small-pilot creator identity: distinct revocable creator credentials and pool membership, never distribution of the global owner key. Specify and adversarially test authorization across UI/API/MCP/sync/search/export. Remote MCP auth must be actually interoperable with supported clients; if a required credential/client cannot be live-tested, report this limit without falsifying completion.
5. Azure is a configured adapter target, not a deployment requirement in this prototype run. No paid resource provisioning; preserve explicit unavailable-live-Azure evidence.
6. Continue the full Nightshift gates and decompose the epic. These choices resolve default selection questions for this build; surface only concrete remaining contradictions, not requests to reconfirm these defaults.

Authoritative integration sources checked by root:
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp (use current canonical article id 11175166 if slug redirects)
- https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- https://learn.microsoft.com/en-us/azure/search/vector-search-overview
Verify exact versioned protocol, provider and security claims before citing them in the spec.
