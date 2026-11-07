# Product grounding blocked — NS-EXTRACT-TRANSPORT-01

The parent remains incomplete. Dashboard defaults are answered; this is a harness/authentication failure, not an unresolved product choice.

## Actual evidence

- `product-extractor.attempt-1.json`: mandatory local/qwen2.5-coder:14b extractor returned FAIL, exit=1 category=unknown, claims empty. The bounded dispatcher stopped after one attempt.
- `product-extractor.attempt-2.json`: smallest configured-route repair (gear 1, attempt 2, Claude/haiku, subscription) returned FAIL: Claude subscription login required. No source claim or independent gate passed.
- `product-extractor.in.md` retains exact task input. `transport-repair.md` records the repair rationale. `repair-checks.json` retains the stable finding and exact JSON target; it expects SUCCESS, and remains failing. This check does not prove complete claims or authorize a gate.
- `operator-context-resumed.json` records the answered dashboard decision. `decomposition.receipt.json` validates five child briefs, complete AC coverage, hashes and final integration ancestry only.
- `child-statuses.json` maps plan IDs to actual task keys and operator contexts. All children are blocked: foundational grounding cannot start; downstream prerequisites are unverified. No child worktrees were prepared prematurely.

## Commands and boundary

The calls used the canonical `nightshift-dispatch-bounded.sh` then `nightshift-agent.sh` with the same input, subscription auth and parent budget task `spec-8f6f6abd84603e7b`; the second call explicitly used gear 1/attempt 2. No global routing/authentication configuration was changed. No inherited budget environment variables were present; both calls bound the same existing parent ledger. The first call did not retain raw provider stderr because diagnostics were not enabled; do not infer its root cause from category=unknown. The second failed at authentication admission, before provider execution.

No spec authoring, adversarial review, implementation, source tests, build, review, drift, QA/final proof or preflight was completed. No push, PR, merge or deployment. Only planning, tracker and failure evidence changed. Existing factory telemetry is retained untracked.

## Recovery

Root controller must restore subscription authentication for the configured Claude route (or repair the configured local transport under policy), then resume extraction with prior failures and parent budget intact. Do not relaunch the failed bounded wrapper as a fresh allowance. No authentication bypass, invented approval, same-provider self-review, or source implementation is permitted by this receipt. Revalidate decomposition hashes; prepare the first child from the explicit immutable base and carry planning documents separately. Subsequent children require verified prerequisite commits. No paid source re-review has occurred.
