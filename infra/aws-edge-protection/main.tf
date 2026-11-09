terraform {
  required_version = ">= 1.17.0, < 2.0.0"
  required_providers { aws = { source = "hashicorp/aws", version = "= 6.72.0" } }
  backend "s3" {}
}
# Shared resource: intentionally no provider default_tags.
provider "aws" { region = "us-east-1" }
locals {
  name           = "CreatedByCloudFront-67c309d9-d8d7-424d-9aa3-82434201127f"
  existing_rules = jsondecode(file("${path.module}/existing-rules.json"))
  host_match = {
    ByteMatchStatement = {
      SearchString         = "pensieve.doctorew.com"
      FieldToMatch         = { SingleHeader = { Name = "host" } }
      PositionalConstraint = "EXACTLY"
      TextTransformations  = [{ Priority = 0, Type = "LOWERCASE" }]
    }
  }
  pensieve_rules = [
    {
      Name   = "PensieveKnownMaliciousIpBlock", Priority = 5
      Action = { Block = {} }
      Statement = { AndStatement = { Statements = [local.host_match, {
        OrStatement = { Statements = [for label in ["AWSManagedIPReputationList", "AWSManagedReconnaissanceList"] : {
          LabelMatchStatement = { Scope = "LABEL", Key = "awswaf:managed:aws:amazon-ip-list:${label}" }
        }] }
      }] } }
      VisibilityConfig = { SampledRequestsEnabled = true, CloudWatchMetricsEnabled = true, MetricName = "PensieveKnownMaliciousIpBlock" }
    },
    {
      Name   = "PensieveIpRateBlock", Priority = 6
      Action = { Block = {} }
      Statement = { RateBasedStatement = {
        Limit              = 300, EvaluationWindowSec = 300, AggregateKeyType = "IP"
        ScopeDownStatement = local.host_match
      } }
      VisibilityConfig = { SampledRequestsEnabled = true, CloudWatchMetricsEnabled = true, MetricName = "PensieveIpRateBlock" }
    }
  ]
}
resource "aws_wafv2_web_acl" "shared" {
  name  = local.name
  scope = "CLOUDFRONT"
  tags  = {}
  default_action {
    allow {}
  }
  rule_json = jsonencode(concat(local.existing_rules, local.pensieve_rules))
  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = local.name
  }
  lifecycle { prevent_destroy = true }
}
import {
  to = aws_wafv2_web_acl.shared
  id = "9a9c7c50-9467-4ef3-8782-841f2f0a4b42/CreatedByCloudFront-67c309d9-d8d7-424d-9aa3-82434201127f/CLOUDFRONT"
}
output "web_acl_arn" { value = aws_wafv2_web_acl.shared.arn }
