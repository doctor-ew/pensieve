# Engineering spec — GitHub #6
Base: deployed PR #5, 601b31e. New work is isolated on feature/secure-sharing. PR #5 must merge before this PR can target main cleanly.

## Verified existing code
- src/team-server.ts createTeamServer: Host/Origin validation, creator session cookies, owner/writer/reader checks, selected-bundle shares.
- src/executive.ts ShareStore: hashed access tokens, invitation-link and email-code modes; challenge/verify already exist with cooldown and attempt limits. Team service currently forces invitation-link and disables mail.
- src/share-server.ts createShareServer: code/verify/ask/download routes; authorizes every recipient read and rechecks after answers.
- src/team-client.ts TeamClient.request: HTTPS, bearer token, no redirects, timeout.
- src/team-service.ts runTeamService: persistent team/share/connector stores and MCP wiring.
- web/team.js: creator pool/list/search/share UI. web/reader.js: email-code sign-in and snapshot view.
These names and behaviors were inspected directly before implementation.

## Design
1. access.ts validates Cloudflare Access RS256 JWTs via pinned team issuer and audience using jose remote JWKS. Keys only fetched from configured *.cloudflareaccess.com host. Validate expiry and human subject or signed service identity. Config must be all-or-nothing. Protected creator/API/connector requests require a valid assertion; only exact health, reader snapshot/API and static assets bypass this extra gate. Existing application auth remains mandatory. Access service-token headers are attached only by configured TeamClient to its exact server origin; redirects remain disabled.
2. delivery.ts stores SQLite reservations for recipient attempts and quota events before network I/O. Fixed configured sender; generated subject/text; no client-provided URL/body. Authenticated pool writer additionally must be original share creator or pool owner (existing share-revocation authorization). Persist per-share/email identity. Status sending/sent/unknown; no retry of attempted sends, including unknown provider acceptance. Quotas: per creator 25/hour, per recipient 5/hour, global 100/hour including verification mail. Provider acceptance means sent, not inbox delivery. Reserve all recipients atomically to avoid partial quota admission.
3. ses-mailer.ts uses AWS SESv2 SDK default credential chain; region and verified sender explicit. Fixed text templates for invitations and verification codes. No bodies/tokens in logs or response errors.
4. Team sharing accepts explicit accessMode; default remains legacy invitation-link for API compatibility. UI defaults verified only when email is configured, otherwise shows unavailable explanation. Verified invitations contain /s/id only; bearer links generated only for invitation-link mode. Add /shares/:id/send with replay-safe durable delivery state. Send is separate from create.
5. verification-guard.ts enforces durable public code/verify request quotas; optional Turnstile validates hostname/action/token using fixed Cloudflare endpoint and bounded timeout. Tokens never logged. Do not trust forwarding headers at origin. UI loads challenge only if configured; CSP allows only required Cloudflare challenge origins.
6. Operational activation is separate: configure creator DNS/Access policies and machine Service Auth; enable origin validation after external paths tested; configure SES verified sender, DKIM/SPF/DMARC and quotas; test invite only to operator-approved recipient. Preserve old recipient hostname/links. No network-wide mutation or live mail occurs during unit/browser tests.

## Adversarial tests
Forged/expired/wrong aud/issuer JWT; no assertion direct-origin API denied; reader still usable; missing partial config refuses startup. Outsider/reader cannot email another creator's snapshot. Caller cannot choose recipients or arbitrary mail content. Concurrent repeats and restart cause no duplicate sends; quota exhaustion reserves nothing; timeout becomes unknown and remains suppressed. Verified URLs have no bearer, wrong/uninvited/reused code fails. Turnstile missing/forged/hostname mismatch blocks send; validation failure reveals no invited-list information. Existing browser capture/share/download/reader-isolation regressions remain green.

## Rollout / rollback
Ship code disabled by absent Access and SES settings. Activate only after external configuration is verified. Removing Access settings is a deliberate security downgrade, never an automatic error fallback. Rollback app version preserves existing share data and delivery ledger. Do not disable public recipient access accidentally. Backup/restore testing and broader audit remain separate follow-up work.

## Works cited
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html
- https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html
- Existing files above plus test/team-server.test.ts, test/team-browser.test.ts, test/executive.test.ts.

## Open signup and infrastructure acceptance — 2026-11-07

- With PENSIEVE_OPEN_SIGNUP=true and verified Access enabled, same-origin POST /api/team/access-session accepts only a signed human subject with email. Service identities cannot register. Misconfigured signup without Access fails startup.
- Persist identities by exact issuer+subject in team_access_identities; atomically create user+mapping. Never merge an existing invitation account by matching email. Revocation survives repeat signup. Existing invitation accounts remain usable.
- Bind Access-created browser sessions to the current issuer+subject; cross-account and service-token reuse returns 401. Limit sessions to five per user. Logout persists across reload until the user explicitly continues; unrelated pool-fetch errors cannot trigger account replacement.
- Default new UI pools to private. Membership authorization remains required for all pools regardless of visibility.
- Terraform pins provider versions and codifies Access login-method policy, service credential, optional DNS cutover, Turnstile, dedicated SES identity/DKIM/mail-from/DMARC, narrowly scoped sender IAM permissions, and separate encrypted/versioned/public-blocked S3 state bootstrap. Mock tests must pass without credentials. CI validates only; never auto-applies.
- Existing Railway resources are not adopted by this module. Custom-domain registration and secret injection remain explicit deployment steps. No IAM keys in Terraform state; Cloudflare-generated secrets do enter state and require restricted backend access.

Works cited: src/access.ts (accessVerifier); src/team-store.ts (accessUser); src/team-server.ts (access-session and session binding); test/secure-sharing.test.ts; test/team-browser.test.ts; infra/terraform/README.md; https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/ ; https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html .
