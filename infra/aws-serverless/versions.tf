terraform {
  required_version = ">= 1.17.0, < 2.0.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "= 6.72.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
  backend "s3" {}
}
provider "aws" {
  region = var.aws_region
  default_tags { tags = { Project = "pensieve", Environment = var.environment, ManagedBy = "terraform" } }
}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
locals {
  name       = "pensieve-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  arn_prefix = "arn:${data.aws_partition.current.partition}"
  public_url = var.activate_custom_domain ? "https://${var.creator_hostname}" : (var.enable_cloudfront ? "https://${aws_cloudfront_distribution.pensieve[0].domain_name}" : aws_apigatewayv2_api.app.api_endpoint)
  common_env = {
    PENSIEVE_AWS_TABLE             = aws_dynamodb_table.app.name
    PENSIEVE_AWS_SNAPSHOT_BUCKET   = aws_s3_bucket.snapshots.id
    PENSIEVE_AWS_VECTOR_BUCKET     = aws_s3vectors_vector_bucket.memories.vector_bucket_name
    PENSIEVE_AWS_VECTOR_INDEX      = aws_s3vectors_index.memories.index_name
    PENSIEVE_PROVIDER              = "bedrock"
    PENSIEVE_MODEL                 = var.embedding_model
    PENSIEVE_EMBEDDING_DIMENSIONS  = tostring(var.embedding_dimensions)
    PENSIEVE_PUBLIC_URL            = local.public_url
    PENSIEVE_OWNER_TOKEN_PARAMETER = var.owner_token_parameter
    PENSIEVE_COGNITO_ISSUER        = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.creators.id}"
    PENSIEVE_COGNITO_CLIENT_ID     = aws_cognito_user_pool_client.browser.id
    PENSIEVE_COGNITO_DOMAIN        = "https://${aws_cognito_user_pool_domain.creators.domain}.auth.${var.aws_region}.amazoncognito.com"
    PENSIEVE_SES_REGION            = var.aws_region
    PENSIEVE_EMAIL_FROM            = var.sender_email
    NODE_OPTIONS                   = "--enable-source-maps"
  }
}
