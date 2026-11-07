# Review — issue #6 / pensieve-536
Scope: feature/secure-sharing versus 601b31e. The source-command-review skill invoked independent code-reviewer and security-auditor agents. This is a focused change review, not a claim that the whole repository satisfies every principle or a penetration test.

## Findings and disposition
- BLOCK, service-token JWT compatibility: Cloudflare service JWTs use empty sub with common_name. Fixed with signed application-token identity validation plus real-shaped test; signature/issuer/audience/expiry retained.
- MEDIUM, proxy-wide verification bucket exhaustion: moved Turnstile before code quota consumption, scoped buckets to share/email/address, indexed expiration cleanup. Invalid-challenge and cross-recipient isolation regressions pass.
- MEDIUM, invitation membership disclosure under mail-provider/quota failure: generic public response for invited/uninvited/provider-failure, sanitized warning only; equivalence tests pass.
- WARN, delivery statuses disappear on reload: authorized GET share-list now returns stored statuses; UI renders them without mutating requests.
- BLOCK raised during re-review, per-share N+1 delivery lookup: replaced with deduplicated 500-ID batched queries and grouped mapping. Boundary/empty tests added.
- Parent review: authorization/revocation is rechecked before each recipient send. Tokens are created only after quota reservation. Duplicate HTTP sends return prior status without issuing more bearer tokens.

## Engineering lenses
| Lens | Assessment |
|---|---|
| DRY | Delivery and quota logic centralized; status formatting reused. Invitation templates still appear in legacy/team flows; future consolidation is advisable. |
| SOLID | Access validation, email transport, durable delivery reservation and verification controls are separate modules behind injected contracts. Existing team server still has many routing/orchestration responsibilities. |
| ACID | Quota/attempt reservation uses one SQLite transaction. Email is outside that transaction: at-most-once attempts, never exactly-once delivery. Existing snapshot/team databases use compensation, not a cross-database transaction. |
| Big O | Recipient count bounded at 25; indexed quota/attempt lookups; batch delivery-status reads. Existing local retrieval remains O(ND + N log N) time and O(ND) memory; external search still loads local authorization rows. |
| CoC | Matches TypeScript ESM module and test conventions. Configuration separates rollout credentials from code. |
| Separation of concerns | New modules separate trust verification, transport and persistence. Monolithic legacy routing/UI deserves follow-up refactoring, not an unbounded rewrite here. |

## Independent security verdict
APPROVE for merge after fixes. Seven focused security tests rerun independently, all passed. External provider activation remains unverified. Aggregate origin connection rate limits can affect multiple users behind a proxy; complementary edge controls are an operational gate.

## Limits
Creator sessions remain memory-only across restarts. Interrupted sends may remain unknown and are never automatically retried. Downloaded snapshots cannot be revoked. Existing public bearer shares remain bearer shares. Full deployment/SES inbox delivery/Cloudflare policy tests are not substituted by local mocked tests.

## Final independent code verdict
APPROVE, no remaining blockers after batched status reads. Focused tests independently rerun: 7/7. Both reviewers distinguish code approval from production activation.
