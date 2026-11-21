# Browser sign-in for Pensieve agents

Cognito remains the human identity provider. Pensieve's existing audience-bound OAuth grants now serve local CLI and stdio clients as well as remote MCP hosts. The local repository context feature remains available independently of cloud authentication.

## Behavior

- `pensieve connect URL --name NAME` starts PKCE authorization using a loopback callback and system browser. `--no-browser` prints the sign-in URL. MCP `connect_pensieve` returns a link without opening windows.
- Unsigned-in users go through the first-party Cognito login and return to explicit consent. Consent displays and binds the verified account and client name.
- Each home has an independent grant. `connection_status`/`connection-status` report local state; `disconnect_pensieve`/`disconnect` revoke that grant. These status commands do not probe network reachability or list all devices.
- Access renewal is serialized across processes, rereads current credentials, and writes credentials atomically with owner-only permissions. A persisted uncertainty marker prevents replay following a crash or lost refresh response. That case requires fresh browser sign-in.
- Queued saves bind to server and verified account rather than a rotating credential. Legacy bindings migrate only after verifying both identities. Other-account and unverifiable queues stay held.
- Each tool request loads the current connection. Fresh sign-in recovers an already-running upgraded agent. Installing the upgraded binary can require a one-time host reload.
- Existing limits remain: one-hour access, seven-day inactivity, thirty-day absolute grant lifetime. Sign-in is therefore still required periodically and after revocation.
- Explicit environment personal tokens remain a legacy override; remove them from host configuration to use OAuth. Existing remote hosts manage their own refresh and storage lifecycle.

## Authorization boundaries

The new `connection_request` MCP tool dispatches only an explicit set of account, pool, memory, policy, indexing and search operations. It does not forward arbitrary URLs, broaden legacy REST token acceptance, grant operator access, or send invitations. Every operation resolves the authenticated actor and enforces pool membership and capture policy through the existing store.

Local state is private to the OS account; this feature does not protect against a malicious process already running as that account. OAuth endpoint discovery is confined to the configured origin. Redirects are forbidden for credential requests, callbacks validate state and host, and token bodies are never included in errors.

## Validation

Local full suite: 150 passed, 20 skipped, zero failed (including Chromium consent). After adding legacy queue and lost-response cases, all four new integration tests passed; TypeScript build and whitespace checks passed. AWS ZIP built and both packaged Lambda handlers imported successfully. Skipped tests require separately configured PostgreSQL/AWS services; these results do not establish live deployment or actual Codex/Claude host verification.

Tests cover browser login return, wrong callback state, account switching at consent, automatic renewal, five overlapping calls, three overlapping processes, rejected access recovery, independent grants, revocation, same-running-MCP reconnection, account-isolated legacy queue migration, and lost refresh replies without replay.

## Rollout

Deploy the server changes before installing the new local OAuth client: older servers lack `connection_request`. Keep the existing personal-key configuration until the deployed browser flow is verified. After upgrade, complete browser consent once for each independent home and verify `list_pools`; then test renewal and revocation in the actual supported hosts. No database migration or Cognito pool replacement is required.

Rollback the local runtime while retaining its private state backup. Do not silently reactivate legacy credentials after an OAuth disconnect. Server rollback removes the new CLI operation tool, so reconnect legacy clients deliberately if rollback is necessary.
