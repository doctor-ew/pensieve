mock_provider "aws" {}
override_resource {
  target = aws_wafv2_web_acl.shared
  values = { id = "9a9c7c50-9467-4ef3-8782-841f2f0a4b42" }
}
run "AC1_preserve_shared_rules" {
  command = plan
  assert {
    condition     = slice(jsondecode(aws_wafv2_web_acl.shared.rule_json), 0, 5) == local.existing_rules && length(jsondecode(aws_wafv2_web_acl.shared.rule_json)) == 7
    error_message = "The five existing rules must remain byte-for-byte equivalent JSON objects."
  }
  assert {
    condition     = length(aws_wafv2_web_acl.shared.default_action[0].allow) == 1 && length(aws_wafv2_web_acl.shared.tags) == 0
    error_message = "Preserve default Allow and untagged shared resource."
  }
  # AC2: only explicit reputation/reconnaissance labels cause the new label block.
  assert {
    condition     = toset([for item in local.pensieve_rules[0].Statement.AndStatement.Statements[1].OrStatement.Statements : item.LabelMatchStatement.Key]) == toset(["awswaf:managed:aws:amazon-ip-list:AWSManagedIPReputationList", "awswaf:managed:aws:amazon-ip-list:AWSManagedReconnaissanceList"])
    error_message = "Do not block generic body/code or DDoS COUNT labels."
  }
  # AC3: both new blocks require the exact Pensieve hostname; no root/wildcard.
  assert {
    condition     = local.pensieve_rules[0].Statement.AndStatement.Statements[0] == local.host_match && local.pensieve_rules[1].Statement.RateBasedStatement.ScopeDownStatement == local.host_match && local.host_match.ByteMatchStatement.SearchString == "pensieve.doctorew.com" && local.host_match.ByteMatchStatement.PositionalConstraint == "EXACTLY"
    error_message = "Both blocks must be limited to the exact Pensieve hostname."
  }
  # AC4: bounded rate rule after existing groups, with real client IP aggregation.
  assert {
    condition     = local.pensieve_rules[1].Statement.RateBasedStatement.Limit == 300 && local.pensieve_rules[1].Statement.RateBasedStatement.EvaluationWindowSec == 300 && local.pensieve_rules[1].Statement.RateBasedStatement.AggregateKeyType == "IP" && local.pensieve_rules[0].Priority == 5 && local.pensieve_rules[1].Priority == 6
    error_message = "Preserve the approved 300 requests/300 seconds/IP threshold and rule ordering."
  }
}
