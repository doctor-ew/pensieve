# Bootstrap with operator credentials. GitHub can update existing Lambda functions,
# but cannot change this trust/policy, runtime roles, data stores, or production DNS.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS retrieves the certificate thumbprint when omitted; no stale pinned thumbprint.
}
resource "aws_iam_role" "github" {
  name                 = "${local.name}-github-deploy"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Condition = { StringEquals = {
        "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        "token.actions.githubusercontent.com:sub" = "repo:doctor-ew@763876/pensieve@1448695474:ref:refs/heads/deploy/aws"
      } }
    }]
  })
}
variable "terraform_state_bucket" {
  type        = string
  default     = "pensieve-tfstate-432230020714-us-east-1"
  description = "Existing backend bucket; deployment role cannot create/delete it."
}
locals {
  state_key = "pensieve/aws-serverless.tfstate"
  state_arn = "${local.arn_prefix}:s3:::${var.terraform_state_bucket}"
}
resource "aws_iam_role_policy" "github" {
  name = "existing-lambda-deployment-and-plan"
  role = aws_iam_role.github.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "StateList", Effect = "Allow", Action = ["s3:ListBucket"], Resource = local.state_arn
        Condition = { StringLike = { "s3:prefix" = [local.state_key, "${local.state_key}.tflock"] } }
      },
      { Sid = "StateLocation", Effect = "Allow", Action = ["s3:GetBucketLocation"], Resource = local.state_arn },
      { Sid = "StateReadWrite", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${local.state_arn}/${local.state_key}", "${local.state_arn}/${local.state_key}.tflock"] },
      { Sid = "ReleaseStateLock", Effect = "Allow", Action = ["s3:DeleteObject"], Resource = "${local.state_arn}/${local.state_key}.tflock" },
      {
        Sid      = "DeployExistingFunctions", Effect = "Allow"
        Action   = ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:GetPolicy", "lambda:GetRuntimeManagementConfig", "lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency", "lambda:TagResource", "lambda:UntagResource"]
        Resource = [for role in ["api", "worker"] : "${local.arn_prefix}:lambda:${var.aws_region}:${local.account_id}:function:${local.name}-${role}"]
      },
      {
        Sid       = "PassOnlyRuntimeRoles", Effect = "Allow", Action = "iam:PassRole"
        Resource  = [for role in ["api", "worker"] : "${local.arn_prefix}:iam::${local.account_id}:role/${local.name}-${role}"]
        Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } }
      },
      {
        Sid      = "InspectRoles", Effect = "Allow", Action = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"]
        Resource = [for role in ["api", "worker", "github-deploy"] : "${local.arn_prefix}:iam::${local.account_id}:role/${local.name}-${role}"]
      },
      { Sid = "InspectOidc", Effect = "Allow", Action = ["iam:GetOpenIDConnectProvider"], Resource = "${local.arn_prefix}:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com" },
      {
        Sid      = "InspectTableConfiguration", Effect = "Allow", Action = ["dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource"]
        Resource = "${local.arn_prefix}:dynamodb:${var.aws_region}:${local.account_id}:table/${local.name}"
      },
      {
        Sid      = "InspectSnapshotConfiguration", Effect = "Allow"
        Action   = ["s3:GetBucketPolicy", "s3:GetBucketPolicyStatus", "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetEncryptionConfiguration", "s3:GetBucketLocation", "s3:GetBucketAcl", "s3:GetBucketCors", "s3:GetBucketWebsite", "s3:GetBucketLogging", "s3:GetBucketNotification", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:GetAccelerateConfiguration", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketRequestPayment"]
        Resource = "${local.arn_prefix}:s3:::${local.name}-snapshots-${local.account_id}"
      },
      {
        Sid      = "InspectVectorsConfiguration", Effect = "Allow", Action = ["s3vectors:GetVectorBucket", "s3vectors:GetIndex", "s3vectors:ListTagsForResource"]
        Resource = ["${local.arn_prefix}:s3vectors:${var.aws_region}:${local.account_id}:bucket/${local.name}-vectors-${local.account_id}", "${local.arn_prefix}:s3vectors:${var.aws_region}:${local.account_id}:bucket/${local.name}-vectors-${local.account_id}/index/*"]
      },
      { Sid = "InspectEventMappingTags", Effect = "Allow", Action = ["lambda:ListTags"], Resource = aws_lambda_event_source_mapping.work.arn },
      { Sid = "InspectQueue", Effect = "Allow", Action = ["sqs:GetQueueAttributes", "sqs:ListQueueTags"], Resource = "${local.arn_prefix}:sqs:${var.aws_region}:${local.account_id}:${local.name}-worker-failures" },
      { Sid = "InspectSchedule", Effect = "Allow", Action = ["events:DescribeRule", "events:ListTargetsByRule", "events:ListTagsForResource"], Resource = "${local.arn_prefix}:events:${var.aws_region}:${local.account_id}:rule/${local.name}-reconcile" },
      { Sid = "InspectDns", Effect = "Allow", Action = ["route53:GetHostedZone", "route53:ListResourceRecordSets"], Resource = "${local.arn_prefix}:route53:::hostedzone/${var.route53_zone_id}" },
      {
        Sid      = "InspectIdentityConfiguration", Effect = "Allow", Action = ["cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DescribeManagedLoginBranding", "cognito-idp:DescribeManagedLoginBrandingByClient", "cognito-idp:ListTagsForResource"]
        Resource = aws_cognito_user_pool.creators.arn
      },
      {
        Sid      = "InspectGateway", Effect = "Allow", Action = ["apigateway:GET"]
        Resource = ["${local.arn_prefix}:apigateway:${var.aws_region}::/apis/${aws_apigatewayv2_api.app.id}", "${local.arn_prefix}:apigateway:${var.aws_region}::/apis/${aws_apigatewayv2_api.app.id}/*", "${local.arn_prefix}:apigateway:${var.aws_region}::/domainnames/${var.creator_hostname}", "${local.arn_prefix}:apigateway:${var.aws_region}::/domainnames/${var.creator_hostname}/*", "${local.arn_prefix}:apigateway:${var.aws_region}::/tags/*"]
      },
      {
        Sid      = "InspectPensieveEdge", Effect = "Allow"
        Action   = ["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:ListTagsForResource"]
        Resource = var.enable_cloudfront ? aws_cloudfront_distribution.pensieve[0].arn : "${local.arn_prefix}:cloudfront::${local.account_id}:distribution/disabled-pensieve"
      },
      {
        Sid      = "InspectPensieveEdgeFunction", Effect = "Allow"
        Action   = ["cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:ListTagsForResource"]
        Resource = "${local.arn_prefix}:cloudfront::${local.account_id}:function/${local.name}-canonical-host"
      },
      {
        Sid      = "InspectPensieveBudgetTags", Effect = "Allow"
        Action   = ["budgets:ListTagsForResource"]
        Resource = "${local.arn_prefix}:budgets::${local.account_id}:budget/${local.name}-monthly"
      },
      {
        Sid      = "InspectMetadataWithoutResourceScoping", Effect = "Allow"
        Action   = ["cognito-idp:DescribeUserPoolDomain", "logs:DescribeLogGroups", "logs:ListTagsForResource", "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource", "lambda:GetEventSourceMapping", "lambda:ListEventSourceMappings", "acm:DescribeCertificate", "acm:ListTagsForCertificate", "budgets:ViewBudget"]
        Resource = "*"
      }
    ]
  })
}
output "github_deploy_role_arn" { value = aws_iam_role.github.arn }
