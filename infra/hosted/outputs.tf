output "application_environment" {
  value = {
    PENSIEVE_PUBLIC_URL        = local.public_url
    PENSIEVE_COGNITO_ISSUER    = "https://${aws_cognito_user_pool.creators.endpoint}"
    PENSIEVE_COGNITO_CLIENT_ID = aws_cognito_user_pool_client.browser.id
    PENSIEVE_COGNITO_DOMAIN    = "https://${aws_cognito_user_pool_domain.creators.domain}.auth.${var.aws_region}.amazoncognito.com"
    PENSIEVE_SES_REGION        = var.aws_region
    PENSIEVE_EMAIL_FROM        = var.sender_email
  }
}
