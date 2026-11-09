mock_provider "random" {
  mock_resource "random_password" { defaults = { result = "fixture-edge-token-with-at-least-48-characters-12345" } }
}
mock_provider "aws" {
  mock_resource "aws_cloudfront_function" {
    override_during = plan
    defaults        = { arn = "arn:aws:cloudfront::123456789012:function/pensieve-aws-canonical-host" }
  }
  mock_resource "aws_acm_certificate" {
    override_during = plan
    defaults        = { arn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012", domain_validation_options = [{ domain_name = "pensieve.doctorew.com", resource_record_name = "_fixture.pensieve.doctorew.com", resource_record_type = "CNAME", resource_record_value = "_fixture.acm-validations.aws" }] }
  }
  mock_resource "aws_acm_certificate_validation" { defaults = { certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012" } }
  mock_resource "aws_cloudfront_distribution" { defaults = { arn = "arn:aws:cloudfront::123456789012:distribution/FIXTURE", domain_name = "fixture.cloudfront.net", hosted_zone_id = "Z2FDTNDATAQYW2" } }
  mock_resource "aws_iam_openid_connect_provider" { defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" } }
  mock_resource "aws_iam_role" { defaults = { arn = "arn:aws:iam::123456789012:role/fixture" } }
  mock_resource "aws_lambda_function" { defaults = { arn = "arn:aws:lambda:us-east-1:123456789012:function:fixture", invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:fixture/invocations" } }
  mock_resource "aws_dynamodb_table" { defaults = { arn = "arn:aws:dynamodb:us-east-1:123456789012:table/fixture", stream_arn = "arn:aws:dynamodb:us-east-1:123456789012:table/fixture/stream/2026-01-01T00:00:00.000" } }
  mock_resource "aws_cloudwatch_event_rule" { defaults = { arn = "arn:aws:events:us-east-1:123456789012:rule/fixture" } }
  mock_resource "aws_sqs_queue" { defaults = { arn = "arn:aws:sqs:us-east-1:123456789012:fixture" } }
  mock_resource "aws_s3vectors_vector_bucket" { defaults = { vector_bucket_arn = "arn:aws:s3vectors:us-east-1:123456789012:bucket/fixture" } }
  mock_resource "aws_s3vectors_index" { defaults = { index_arn = "arn:aws:s3vectors:us-east-1:123456789012:bucket/fixture/index/memories" } }
  mock_resource "aws_apigatewayv2_api" { defaults = { api_endpoint = "https://fixture.execute-api.us-east-1.amazonaws.com", execution_arn = "arn:aws:execute-api:us-east-1:123456789012:fixture" } }

  mock_data "aws_caller_identity" { defaults = { account_id = "123456789012" } }
  mock_data "aws_partition" { defaults = { partition = "aws" } }
}
variables {
  enable_cloudfront      = false
  enable_workers         = true
  read_capacity          = 5
  write_capacity         = 5
  api_concurrency        = 5
  worker_concurrency     = 2
  prepare_custom_domain  = false
  activate_custom_domain = false
  route53_zone_id        = "ZFIXTURE"
  ses_identity_arn       = "arn:aws:ses:us-east-1:123456789012:identity/mail.example.com"
  sender_email           = "share@mail.example.com"
  owner_token_parameter  = "/pensieve/fixture/owner-token"
  lambda_zip             = "tests/fixture.zip"
  budget_emails          = ["operator@example.com"]
}
run "AC11_serverless_defaults" {
  command = apply
  # AC11: deployment credentials bind to the repository and approved AWS branch.
  assert {
    condition     = jsondecode(aws_iam_role.github.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:doctor-ew@763876/pensieve@1448695474:ref:refs/heads/deploy/aws" && jsondecode(aws_iam_role.github.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    error_message = "GitHub trust must exclude forks, other branches and other audiences."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.github.policy, "iam:PutRolePolicy") && !strcontains(aws_iam_role_policy.github.policy, "route53:ChangeResourceRecordSets") && !strcontains(aws_iam_role_policy.github.policy, "ssm:GetParameter") && strcontains(aws_iam_role_policy.github.policy, "lambda:UpdateFunctionCode")
    error_message = "Deployment may update functions but cannot grant IAM access, change DNS or read the owner secret directly."
  }
  assert {
    condition     = toset(aws_cognito_user_pool.creators.sign_in_policy[0].allowed_first_auth_factors) == toset(["PASSWORD", "EMAIL_OTP"])
    error_message = "Cognito requires PASSWORD alongside optional email OTP first auth."
  }
  assert {
    condition     = length(aws_route53_record.creator) == 0 && length(aws_acm_certificate.creator) == 0
    error_message = "Initial provisioning must not cut over production DNS."
  }
  assert {
    condition     = aws_dynamodb_table.app.billing_mode == "PROVISIONED" && aws_dynamodb_table.app.read_capacity == 5 && aws_dynamodb_table.app.write_capacity == 5 && aws_dynamodb_table.app.deletion_protection_enabled
    error_message = "Use bounded free-allowance-compatible capacity and protect data."
  }
  assert {
    condition     = aws_lambda_function.runtime["api"].reserved_concurrent_executions == 5 && aws_lambda_function.runtime["worker"].reserved_concurrent_executions == 2
    error_message = "Bound concurrent workload."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.snapshots.block_public_policy && aws_s3_bucket_public_access_block.snapshots.restrict_public_buckets && !aws_s3_bucket.snapshots.force_destroy
    error_message = "Snapshot objects must stay private and cannot be force-destroyed."
  }
  assert {
    condition     = aws_s3vectors_index.memories.dimension == 256 && aws_s3vectors_index.memories.distance_metric == "cosine"
    error_message = "Index schema must match configured Titan vectors."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.runtime["api"].policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.runtime["api"].policy, "s3vectors:PutVectors")
    error_message = "API role must not scan or mutate the semantic index."
  }
  assert {
    condition     = aws_lambda_event_source_mapping.work.batch_size == 1 && aws_lambda_event_source_mapping.work.maximum_retry_attempts == 10 && aws_lambda_event_source_mapping.work.function_response_types == toset(["ReportBatchItemFailures"])
    error_message = "Failed batches need bounded retries and partial failure reporting."
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.runtime["api"].policy, "dynamodb:ConditionCheckItem") && strcontains(aws_iam_role_policy.runtime["worker"].policy, "dynamodb:ConditionCheckItem") && !strcontains(aws_iam_role_policy.runtime["worker"].policy, "ssm:GetParameter")
    error_message = "Transactions require ConditionCheckItem; workers must not read the operator secret."
  }

  assert {
    condition     = aws_cloudwatch_event_rule.reconcile.schedule_expression == "rate(1 hour)" && aws_cloudwatch_event_rule.reconcile.state == "ENABLED" && jsondecode(aws_cloudwatch_event_target.reconcile.input).kind == "reconcile"
    error_message = "Durable work must have bounded hourly recovery outside the stream retention window."
  }

}

run "AC5_import_disables_background_work" {
  command = plan
  variables { enable_workers = false }
  assert {
    condition     = !aws_lambda_event_source_mapping.work.enabled && aws_cloudwatch_event_rule.reconcile.state == "DISABLED"
    error_message = "Import maintenance mode must disable stream and scheduled processing."
  }
}

# AC11: Dedicated edge keeps authenticated data uncached and leaves root DNS untouched.
run "AC11_cloudfront_staging" {
  command = apply
  assert {
    condition     = length(aws_cloudfront_function.canonical_host) == 0 && length(aws_cloudfront_distribution.pensieve[0].default_cache_behavior[0].function_association) == 0
    error_message = "Staging CloudFront hostname remains available before cutover."
  }
  assert {
    condition     = length([for statement in jsondecode(aws_iam_role_policy.github.policy).Statement : statement if statement.Sid == "InspectPensieveEdge" && statement.Resource == aws_cloudfront_distribution.pensieve[0].arn && toset(statement.Action) == toset(["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:ListTagsForResource"])]) == 1
    error_message = "Deployer must have exactly the dedicated distribution's read-only refresh permissions."
  }

  variables { enable_cloudfront = true }
  assert {
    condition     = aws_cloudfront_distribution.pensieve[0].default_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" && aws_cloudfront_distribution.pensieve[0].default_cache_behavior[0].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    error_message = "Use managed no-cache and all-viewer-except-host policies."
  }
  assert {
    condition     = alltrue([for response in aws_cloudfront_distribution.pensieve[0].custom_error_response : response.error_caching_min_ttl == 0]) && length(aws_cloudfront_distribution.pensieve[0].default_cache_behavior[0].allowed_methods) == 7
    error_message = "All methods must reach the app and private error responses must not be cached."
  }
  assert {
    condition     = aws_lambda_function.runtime["api"].environment[0].variables.PENSIEVE_EDGE_TOKEN == random_password.edge[0].result && !contains(keys(aws_lambda_function.runtime["worker"].environment[0].variables), "PENSIEVE_EDGE_TOKEN")
    error_message = "Only the API Lambda receives the shared origin token."
  }
  assert {
    condition     = local.public_url == "https://${aws_cloudfront_distribution.pensieve[0].domain_name}" && length(aws_route53_record.creator) == 0 && contains(aws_cognito_user_pool_client.browser.callback_urls, "${local.public_url}/auth/callback")
    error_message = "Stage on CloudFront with matching auth callbacks before changing Pensieve DNS."
  }
  assert {
    condition     = aws_cloudfront_distribution.pensieve[0].web_acl_id == var.existing_waf_arn && length(aws_cloudfront_distribution.pensieve[0].aliases) == 0
    error_message = "Attach only the selected existing ACL and avoid claiming root or unrelated aliases."
  }
}

# AC11: reject distribution-host bypass of the Pensieve-only WAF rules after cutover.
run "AC11_live_edge_host_guard" {
  command = plan
  variables {
    enable_cloudfront      = true
    activate_custom_domain = true
  }
  assert {
    condition     = length(aws_cloudfront_function.canonical_host) == 1 && aws_cloudfront_function.canonical_host[0].runtime == "cloudfront-js-2.0" && aws_cloudfront_function.canonical_host[0].publish
    error_message = "Live custom hostname must publish the edge host guard."
  }
  assert {
    condition     = length([for association in aws_cloudfront_distribution.pensieve[0].default_cache_behavior[0].function_association : association if association.event_type == "viewer-request" && association.function_arn == aws_cloudfront_function.canonical_host[0].arn]) == 1
    error_message = "Host guard must run before any origin forwarding."
  }
}
