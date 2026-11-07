# Activation and rollback — not yet activated

This branch implements controls; it does not provision Cloudflare or AWS. Existing production access/shares remain unchanged until a separately verified rollout.

## Creator access
Configure PENSIEVE_PUBLIC_URL to the HTTPS creator hostname and PENSIEVE_READER_URL to the existing reader origin (preserves existing /s links). Add the creator custom domain to Railway and Cloudflare DNS. Configure a Cloudflare Access self-hosted application for the entire creator hostname, an allow policy for approved identities, and a separate Service Auth policy for approved agent service tokens. Do not use an Everyone bypass.

Set PENSIEVE_ACCESS_ISSUER to the exact HTTPS Cloudflare team origin and PENSIEVE_ACCESS_AUDIENCE to the application's audience. Both must be present; partial configuration refuses startup. The origin validates RS256 signature, issuer, audience, expiry and human/service identity. Creator credentials and pool roles are still required. Missing/bad Access assertions fail closed. Public reader routes and health/static-reader routes are the only bypasses, never creator APIs. Cloudflare's edge handles interactive login; direct requests to Railway do not.

Terminal client environments need PENSIEVE_CF_ACCESS_CLIENT_ID, PENSIEVE_CF_ACCESS_CLIENT_SECRET and PENSIEVE_CF_ACCESS_ORIGIN equal to their configured team server origin. Keep these in a secret store, not a committed MCP file. The CLI refuses partial credentials or mismatched origin and will not follow redirects. Existing browser-app MCP integrations require compatible service headers and are not claimed to work automatically.

Validate with an allowed human, denied human, valid agent, missing/forged JWT and direct-origin creator request. Confirm existing recipient snapshot links, their downloads, and revocation still work. Keep current personal invitation available privately during the hostname cutover. Creator sessions are currently in memory: a process restart requires a fresh personal sign-in; Cloudflare does not remove that existing limitation.

## AWS SES
Set PENSIEVE_SES_REGION and PENSIEVE_EMAIL_FROM (bare verified email address). AWS SDK credentials are server-side through its standard provider chain. Scope IAM to SES SendEmail for the selected verified identity and From address; prefer short-lived workload credentials where available. Do not place AWS credentials in browser code or generated bundles.

Verify the sending identity, DKIM, SPF/custom MAIL FROM and DMARC in DNS. Check whether the SES account is in sandbox and request production sending before inviting unverified mailboxes. Configure AWS quotas, bounce/complaint monitoring and alarms. Do not treat provider acceptance as confirmed inbox delivery.

Creators choose verified recipients or anyone-with-link when creating a snapshot, then explicitly click Send invitations. There is no automatic send on create, GET, preview, refresh or download. Targets/title/link/expiry come from the stored snapshot. A pool owner or original share creator with current write access may send. Caller-supplied recipients or body fields on the send endpoint are ignored.

Delivery attempts reserve before network I/O. Limits: 25/creator/hour, 5/recipient/hour and 100/global/hour; verification traffic additionally shares a 25/hour verification-sender cap. These are conservative pilot limits. Repeated sends for a share/recipient never automatically resend. A timeout/failure is "unknown", not delivered: inspect provider logs before creating a new invitation. An interrupted process may leave pending attempts; after two minutes they are shown as unknown. Email plus SQLite cannot be one atomic distributed transaction; the design favors avoiding duplicates over guaranteed delivery.

## Verification bot controls
Public code requests: 10/minute per share/recipient/origin connection address. Verification attempts: 30/minute for the same scoped bucket. Invalid Turnstile challenges do not consume recipient buckets. ShareStore additionally enforces recipient cooldown, 5 code emails/hour and 5 wrong guesses/code. Limits persist in the share database except existing global HTTP rate limits.

Optional Turnstile requires PENSIEVE_TURNSTILE_SITE_KEY plus PENSIEVE_TURNSTILE_SECRET. Restrict the site key to the reader hostname. The server validates success, exact hostname and action pensieve-email with Cloudflare. Missing/invalid/expired/replayed challenges fail closed when enabled. No client IP forwarding header is trusted; behind a proxy, limits for the same share and recipient can aggregate visitors. Cloudflare WAF/rate controls should complement this conservative origin limiter. Configure email send abuse limits separately from legitimate MCP traffic.

## Rollout evidence checklist
- Backup persistent volume and demonstrate a restore before sensitive usage.
- Enable Access only after allowed/denied human and service-token testing.
- Test SES with the operator's approved address; no real mail is sent by automated tests.
- Check old and new reader hosts, link/verified modes, revocation, duplicate sends, quota exhaustion and UI error messages.
- Confirm secrets absent from logs, generated content and public assets.
- Record actual provider resources, deployment ID, audience and DNS status separately; never substitute mocked tests for production proof.

## Rollback
Disable SES configuration to remove send/verified-create capability; existing bearer snapshots keep working. Existing verified shares require restoring email delivery to issue new codes. Preserve database tables and reservations across rollbacks. Removing Access variables is a deliberate security downgrade and requires an explicit operational decision; authentication errors never trigger this automatically.

## Sources
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/
- https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html
- https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html
