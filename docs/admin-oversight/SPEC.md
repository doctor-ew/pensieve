# Owner administration, audit activity and notifications

Status: implementation authorized. Only verified drew@doctorew.com is the platform administrator and can see all recorded activity. Email alert frequency, private content inspection and creator approval remain separate pending choices. This release implements the portal and audit feed without changing those policies. Requested 2026-11-08. This scope does not change existing websites' protection.

## Product intent
Drew must administer Pensieve from a browser: inspect activity, identify abuse, suspend accounts, revoke shares, stop email abuse, and inspect delivery outcomes. Ordinary creator and pool-owner roles must not imply platform administrator privileges.

## Verified current implementation
- AWS runtime initializes SES from PENSIEVE_EMAIL_FROM/PENSIEVE_SES_REGION: src/aws-runtime.ts:26; src/ses-mailer.ts:4.
- Existing operator API can create/revoke users using a separate owner bearer token: src/identity-routes.ts:54. It is not a browser admin portal.
- Cognito identity subject is verified during callback and mapped to durable users: src/identity-routes.ts:38.
- Existing email outbox preserves ambiguous send results rather than blindly resending: src/aws-delivery.ts.
- Implemented owner portal: src/aws-admin.ts and web/admin.html. Daily metadata audit feed: src/aws-audit.ts and src/aws-http-audit.ts. Automatic owner email alerts are not enabled. MCP read auditing and complete membership/policy-change coverage remain outstanding.

## Required design
1. Bootstrap Drew using the immutable verified Cognito issuer+subject after account creation, never by matching an arbitrary email string on every request. Operator bootstrap stays server-side; never place the operator key in browser storage.
2. Server-side administrator authorization on every admin endpoint. No reliance on hidden UI controls. Administrator content access, if enabled, requires audit records and an explicit user-facing policy.
3. Paginated admin portal: accounts, pools, shares, delivery status, activity, abuse controls. Indexed access paths rather than table scans per page. Avoid N+1 lookups.
4. Record actor, target IDs, action, time, outcome and correlation ID for account registration, memory creation, share creation/revocation, email submission/result, authorized share access and downloads. Never log passwords, invitation grants, bearer tokens, OTPs or full memory text in routine activity records.
5. Successful authorized reader-data access is an access event, not proof that a human read it. Link-mode access cannot reliably identify the human recipient. Do not claim email-open tracking from SES acceptance or a link preview. Deduplicate first-open alerts per share/grant window while retaining bounded activity history.
6. Persist event+notification intent atomically with the underlying mutation where possible. At-least-once processing must not create duplicate alert floods. Alert routing is fixed to the owner configuration; untrusted recipients or memory contents cannot alter destinations/templates.
7. SES notifications use the existing role-bound sender and a separate alert budget/quota so a traffic spike cannot email-bomb Drew. Security alerts and activity digests have separate categories. Notification frequency is pending owner selection.
8. Account suspension invalidates sessions and denies future writes. Share revocation and email-send suspension are separate explicit controls. Administrator actions are themselves audited.
9. WAF blocking applies only to pensieve.doctorew.com. Preserve original shared ACL rules and other-host behavior. First slice uses known malicious/reconnaissance IP labels and bounded request rates; broad content signatures require tuning against saved conversations/code.
10. Infrastructure, IAM, indexes, queues/schedules, retention and budgets are declarative. No paid always-on service is required.

## Pending decisions
- Full content inspection vs metadata-only administration.
- Immediate per-event emails vs daily digest with immediate security alerts.
- Approval-required creators vs verified-email self-service with quotas.

## Acceptance / adversarial proof
- Non-admin verified users cannot list or modify global data; forged email/headers and cross-account IDs do not grant administration.
- Repeated deliveries/retries do not duplicate owner notifications; failed/ambiguous SES outcomes remain distinguishable from delivered email.
- Expired/revoked/unauthenticated reader requests do not generate successful-open events.
- Private memory content and grants do not leak into audit lists, email subjects, logs or exports.
- Existing root-site WAF requests keep the same actions; scoped Pensieve requests exercise blocking rules.
- Browser administrator controls, audit pagination, suspension, share revocation, and configured notification frequency receive runtime proof before being marked complete.

## Works cited
- AWS WAF Count/Block semantics: https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-action.html
- AWS WAF label matching: https://docs.aws.amazon.com/waf/latest/developerguide/waf-labels.html
- AWS WAF pricing: https://aws.amazon.com/waf/pricing/
