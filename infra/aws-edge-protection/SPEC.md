# Pensieve-only edge blocking

Approved scope: adopt the existing shared CloudFront web ACL into a separate Terraform state and add two rules for `pensieve.doctorew.com`. Existing hosts and all five COUNT rules retain their behavior. Implementation plan: snapshot and ownership checks; preserve rules as canonical JSON; append exact-host label/rate rules; validate mocked behavior and the live read-only import plan. Files are limited to this module. No application, distribution, DNS or existing stack changes.

## Acceptance criteria

1. Import the existing ACL; no new ACL or replacement. Preserve all five rule objects, priorities, default Allow, metrics/sampling and empty tags. Prevent destruction.
2. At priority 5 block only the exact AWS IP reputation and reconnaissance labels, and only on the Pensieve host. Existing managed groups run first and continue COUNT.
3. At priority 6 block IPs exceeding the configured 300 requests/300-second evaluation window only on that same host. Other hosts never match either new rule.
4. Do not add body, SQL or generic code-pattern blocking; memories can legitimately contain code. No Bot Control subscription or CAPTCHA.
5. Use separate encrypted/locked S3 state `pensieve/aws-edge-protection.tfstate`. Plan must import and update only the existing ACL; no deletes or changes to pre-existing rules.
6. Validate with mocks and plan comparison; do not generate abusive live traffic. Coordinator reviews and applies.

## Evidence and ownership

2026-11-08 live WAF read: five COUNT rules, default Allow, all sampling/metrics enabled, empty tags, `ManagedByFirewallManager=false`, `RetrofittedByFirewallManager=false`. CloudFormation `DescribeStackResources` lookups using both ACL ID and ARN returned no owning stack. This is evidence against CloudFormation ownership, not proof that an external Terraform state or console automation does not exist. The new state must be the sole writer going forward. No existing stack is modified.

Private pre-change snapshot: `/tmp/pensieve-existing-waf-backup.json` (0600). `existing-rules.json` contains only the five non-secret rule definitions. AWS provider `rule_json` avoids lossy rewriting of their nested objects. Provider 6.72.0 does not expose `OnSourceDDoSProtectionConfig`; the existing `ACTIVE_UNDER_DDOS` field must be checked again after apply to confirm preservation.

Sources: [WAF IP reputation labels](https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html), [Terraform ACL import](https://registry.terraform.io/providers/hashicorp/aws/6.72.0/docs/resources/wafv2_web_acl), [WAF pricing](https://aws.amazon.com/waf/pricing/).

## Cost and operational limits

Two additional standard rules add approximately $2/month, prorated hourly, under published pay-as-you-go pricing. Existing ACL/request charges remain; this is not another $5 ACL. No paid Bot Control, new managed group, or broader inspection is added. Rate enforcement is approximate and can temporarily block legitimate users sharing an IP. Rules match the exact hostname after lowercase normalization; alternate CloudFront distribution hostnames do not match. Application authentication and direct-origin protection still apply.

## Run and review

```sh
AWS_PROFILE=doctorew terraform init -backend-config=backend.hcl.example
terraform validate
terraform test
AWS_PROFILE=doctorew terraform plan -out=/tmp/pensieve-edge-protection.tfplan
terraform show -json /tmp/pensieve-edge-protection.tfplan > /tmp/pensieve-edge-protection-plan.json
python3 verify-plan.py /tmp/pensieve-edge-protection-plan.json /tmp/pensieve-existing-waf-backup.json
```

Run from this directory. The import block adopts the resource only when the reviewed plan is applied; generating a plan does not modify WAF. After apply, re-read the ACL and compare the original five rules/default/visibility/tags and DDoS setting. Check normal Pensieve and unrelated-host requests; do not send a rate-limit traffic burst. Roll back by removing only the two new rules from configuration and reviewing an in-place update. Never destroy the ACL or remove existing rules.

CONVENTION_CHECK: aws-edge-protection — no existing classes modified; isolated module with no provider default tags.

## Verification receipt

Terraform validate passed; mocked acceptance test passed. Live import plan contains one import plus one in-place ACL update, with only `rule`/`rule_json` fields changed. `verify-plan.py` confirmed the five existing rule objects, default Allow, visibility and tags match the private live snapshot. AWS `CheckCapacity` accepted the complete seven-rule payload and returned 1,145 WCU (existing 1,127), below the 1,500-WCU base allocation. No WAF update or traffic burst was performed by the implementation agent.
