# Scope and drift review

Manual delivery implements the separate creator service, UI, pool ACL/provenance/policy layer, offline terminal client, supported session watcher and bundle import, stdio and OAuth remote MCP, Azure vector adapter, portability, docs and runtime tests from SPEC.md/A1–A6. Legacy reader/service command remains the Docker default. New runtime dependencies require production node_modules in the image and browser dependencies in CI.

The following are explicit limits rather than completed claims: live Claude account connection; live Azure service provisioning/query; automatic capture of all conversational-browser history; Dots/Muse native integration; automatic model-generated distillation. User-supplied/agent-supplied distilled memories and text/bundle upload work without a model. KSU remains deferred. No tickets are modified and memory does not authorize builds.

No changes to the Nightshift routing, auth, retry budgets or formal failure gates. No changes to production deployment settings or real memory databases. New manual review artifacts coexist with the original failure evidence.

Scope additions needed to make the product usable: personal credential connection file, operator invite/revoke commands, browser session token exchange, explicit historical bundle contribution command, and deterministic standalone local-vector smoke. All directly support the accepted ACs.
