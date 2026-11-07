# Secure creator access and safe sharing
Status: implementation authorized by Drew, 2026-11-07. Activation configuration remains pending.

## Problem
Creators need to see, search, select and share memories in one browser UI. Security must not send them into repeated sign-in loops or confuse creator access with recipient access. Existing emailed links are bearer credentials; naming an email does not verify its holder. Adding outbound email must not create a spam relay.

## Users and outcomes
- Creator: signs in through Cloudflare Access and existing personal account authorization; creates a selected snapshot; chooses verified-recipient or explicit anyone-with-link access; sends invitations from Pensieve.
- Recipient: opens an invitation; verified mode requires an expiring code delivered to an invited mailbox; link mode preserves deliberate forwarding.
- Engineer: existing authenticated MCP/CLI workflows remain usable through a documented machine credential configuration.

## Scope
Cloudflare origin enforcement, distinct verified/link sharing choices, AWS SES sender adapter, persistent send quotas and duplicate suppression, verification abuse controls, clear UI delivery status, activation/rollback instructions.
No provider migration, no public signup, no arbitrary email composition, no automatic sends, no claim of complete protection from mailbox compromise or forwarding.
Existing snapshots keep their original access mode. Existing published links remain valid until their configured expiry/revocation.

## Acceptance
1. Configured Access protection rejects missing, forged, expired and wrong-audience JWTs at the origin.
2. Public recipient routes remain available without creator Access; personal pool APIs still require existing membership.
3. Agents use verified Access service credentials without interactive redirects; no bearer-only bypass.
4. Verified shares never expose an access token in their initial invitation URL. Only invited emails receive codes; successful verification is single-use and expires.
5. Anyone-with-link sharing is explicitly labeled. Legacy shares remain compatible.
6. Sending is an explicit creator action for a share they own; targets and content come from the stored share, never arbitrary request HTML/URL.
7. Durable quotas and per-share-recipient duplicate suppression bound sending across restarts. Provider timeout is uncertain, never silently retried or reported delivered.
8. Unauthenticated code requests are rate-limited; optional Turnstile is validated on the server and fails closed.
9. UI exposes access mode, Send invitations, pending/sent/failed/uncertain states, and retains copy-link/email-draft alternatives.
10. Local and CI tests cover authorization, negative JWT checks, recipient verification, quotas, provider errors, and browser regressions.
11. Production activation requires real Cloudflare application/audience, allowed identities, SES verified sender/region and account permissions. Unconfigured features fail explicitly; no live messages are sent by tests.

## Pending deployment values
Creator hostname, allowed creator identities, Cloudflare team/audience, machine service policy, SES sender/region, DNS authentication, optional Turnstile site/secret. These are configuration, not invented credentials or silently provisioned resources.
