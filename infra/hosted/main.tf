locals { public_url = "https://${var.creator_hostname}" }
resource "aws_cognito_user_pool" "creators" {
  name                     = "pensieve-creators"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"
  username_configuration { case_sensitive = false }
  admin_create_user_config { allow_admin_create_user_only = false }
  sign_in_policy { allowed_first_auth_factors = ["PASSWORD", "EMAIL_OTP"] }
  email_configuration {
    email_sending_account = "DEVELOPER"
    source_arn            = var.ses_identity_arn
    from_email_address    = "Pensieve <${var.sender_email}>"
  }
  user_attribute_update_settings { attributes_require_verification_before_update = ["email"] }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = split(":", var.ses_identity_arn)[3] == var.aws_region
      error_message = "Use the verified SES identity in the Cognito region."
    }
  }
}
resource "aws_cognito_user_pool_client" "browser" {
  name                                 = "pensieve-browser"
  user_pool_id                         = aws_cognito_user_pool.creators.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_USER_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  callback_urls                        = ["${local.public_url}/auth/callback"]
  logout_urls                          = ["${local.public_url}/"]
  access_token_validity                = 15
  id_token_validity                    = 15
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
resource "aws_cognito_user_pool_domain" "creators" {
  domain                = var.cognito_domain_prefix
  user_pool_id          = aws_cognito_user_pool.creators.id
  managed_login_version = 2
}
resource "aws_cognito_managed_login_branding" "browser" {
  user_pool_id                = aws_cognito_user_pool.creators.id
  client_id                   = aws_cognito_user_pool_client.browser.id
  use_cognito_provided_values = true
  depends_on                  = [aws_cognito_user_pool_domain.creators]
}
resource "aws_route53_record" "creator" {
  count   = var.create_creator_dns ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.creator_hostname
  type    = "CNAME"
  ttl     = 300
  records = [var.railway_cname_target]
}
