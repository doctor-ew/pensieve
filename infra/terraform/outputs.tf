output "application_environment" {
  value = {
    PENSIEVE_OPEN_SIGNUP        = "true"
    PENSIEVE_PUBLIC_URL         = "https://${var.creator_hostname}"
    PENSIEVE_READER_URL         = "https://${var.reader_hostname}"
    PENSIEVE_ACCESS_ISSUER      = "https://${var.cloudflare_team_domain}"
    PENSIEVE_ACCESS_AUDIENCE    = cloudflare_zero_trust_access_application.creator.aud
    PENSIEVE_SES_REGION         = var.aws_region
    PENSIEVE_EMAIL_FROM         = var.sender_email
    PENSIEVE_TURNSTILE_SITE_KEY = cloudflare_turnstile_widget.reader.id
  }
}
output "turnstile_secret" {
  value     = cloudflare_turnstile_widget.reader.secret
  sensitive = true
}
output "agent_credentials" {
  value = {
    PENSIEVE_CF_ACCESS_CLIENT_ID     = cloudflare_zero_trust_access_service_token.agents.client_id
    PENSIEVE_CF_ACCESS_CLIENT_SECRET = cloudflare_zero_trust_access_service_token.agents.client_secret
    PENSIEVE_CF_ACCESS_ORIGIN        = "https://${var.creator_hostname}"
  }
  sensitive = true
}
output "ses_sender_iam_user" { value = aws_iam_user.sender.name }
