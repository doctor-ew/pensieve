mock_provider "aws" {}
variables {
  route53_zone_id       = "ZFIXTURE"
  railway_cname_target  = "fixture.up.railway.app"
  cognito_domain_prefix = "pensieve-fixture"
  ses_identity_arn      = "arn:aws:ses:us-east-1:123456789012:identity/mail.example.com"
  sender_email          = "share@mail.example.com"
}
run "customer_auth_defaults" {
  command = plan
  assert {
    condition     = length(aws_route53_record.creator) == 0
    error_message = "DNS cutover must remain disabled until rollout checks pass."
  }
  assert {
    condition     = aws_cognito_user_pool.creators.user_pool_tier == "ESSENTIALS" && contains(aws_cognito_user_pool.creators.sign_in_policy[0].allowed_first_auth_factors, "EMAIL_OTP")
    error_message = "Customer email-code authentication requires the configured Essentials feature tier."
  }
  assert {
    condition     = aws_cognito_user_pool_client.browser.generate_secret == false && toset(aws_cognito_user_pool_client.browser.allowed_oauth_flows) == toset(["code"])
    error_message = "Browser login must use the public authorization-code client, never implicit or client credentials."
  }
  assert {
    condition     = toset(aws_cognito_user_pool_client.browser.callback_urls) == toset(["https://pensieve.doctorew.com/auth/callback"])
    error_message = "Callback must be exact and pinned to the creator origin."
  }
  assert {
    condition     = aws_cognito_user_pool.creators.email_configuration[0].source_arn == var.ses_identity_arn
    error_message = "Use the existing SES identity rather than duplicate infrastructure."
  }
}
