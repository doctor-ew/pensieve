# Production verification — 2026-11-08

Deployed using Terraform from deploy/aws in the secure-sharing worktree. The deployed implementation is committed on deploy/aws. Production deployment was performed by the local operator using Terraform, not by GitHub Actions. The publication adds validation, packaging and OIDC-authenticated plan workflows.

## Live pages
- https://pensieve.doctorew.com/connect — guided setup for six providers.
- https://pensieve.doctorew.com/admin — owner administration; verified drew@doctorew.com only.

## Verified
- Terraform initial apply: one CloudFront function created, distribution updated, two Lambda functions updated, stream filter updated. No deletion. Follow-up apply updated only the two Lambda code packages.
- Live browser: homepage navigation to setup, all six provider instructions, discovery service check, no JavaScript errors. Anonymous admin redirects to sign-in; anonymous/spoofed admin APIs deny access.
- Live connector: OAuth registration, consent, PKCE exchange, official MCP SDK initialization, five tools, authorized pool listing, token revocation. Fixed serverless-http rawHeaders omission that caused MCP Content-Type rejection.
- Live selected-memory share, unauthorized denial, download, and actual revoked-share denial all passed. Nine pensive build memories preserved. Smoke requests paced under the API throttle after an initial 429.
- Live audit records include memory list, share create/open/download/revoke. Existing five app accounts backfilled into the admin roster. No historical activity invented.
- Verified Cognito registration of drew@doctorew.com and drew@doctorew.xyz. The latter has no administrator authority. Owner subject pin occurs on first successful admin access, not during this deployment.
- Sign-out fix: destroy the Pensieve session and return the configured Cognito logout URL; browser follows it. New login requests include prompt=login. Live proof confirmed old app cookie denied after sign-out and trusted provider sign-out destination returned.
- Full pre-followup suite: 122 passed, 17 skipped. Follow-up identity/browser/runtime tests: 23 passed, 1 skipped; additional logout route regression passed. Type checking/build passed.

## Remaining limits
- Full positive admin journey requires Drew to sign in as drew@doctorew.com and open /admin. Local authorization and admin UI tests pass, but no owner session was manufactured for production testing.
- Automatic administrator email notifications are not enabled; frequency is undecided.
- MCP read audit coverage, complete membership/policy auditing, and logout actor preservation are unfinished. The portal is a first release, not complete all-activity coverage.
- Direct Claude/ChatGPT/Muse/Grok account integration has not been verified in those products. The hosted MCP protocol flow was verified with the official SDK. Muse uses a paste/import fallback.
- Records expire after 30 days; activity contains metadata, not private conversation content.

## Reproducible proof
- scripts/prove-onboarding.mjs
- scripts/prove-aws-connector.mjs
- scripts/prove-aws-http.ts
- scripts/prove-signout.mjs
Proof credentials are supplied privately through environment variables, never written to this receipt.

## Cognito return-loop fix
A real browser regression reproduced a successful cross-site Cognito callback followed by a missing session on the protected /admin redirect. Cognito-mode app cookies now use SameSite=Lax; non-Cognito sessions retain Strict. Secure/HttpOnly, verified identity, one-use state/PKCE, same-origin write checks, and sole-owner admin authorization remain enforced. Regression failed before and passed after the change. Focused tests: 25 passed, one skipped. Follow-up Terraform plan changes only the two Lambda packages. Fresh sign-in must begin at /auth/login?returnTo=/admin; old copied provider URLs contain short-lived, single-use login state.
