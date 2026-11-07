resource "cloudflare_zero_trust_access_policy" "creators" {
  account_id = var.cloudflare_account_id
  name       = "Pensieve verified creators"
  decision   = "allow"
  include    = [for idp in sort(tolist(var.allowed_identity_provider_ids)) : { login_method = { id = idp } }]
}
resource "cloudflare_zero_trust_access_service_token" "agents" {
  account_id = var.cloudflare_account_id
  name       = "Pensieve agent access"
  duration   = "8760h"
}
resource "cloudflare_zero_trust_access_policy" "agents" {
  account_id = var.cloudflare_account_id
  name       = "Pensieve authenticated agents"
  decision   = "non_identity"
  include    = [{ service_token = { token_id = cloudflare_zero_trust_access_service_token.agents.id } }]
}
resource "cloudflare_zero_trust_access_application" "creator" {
  account_id                 = var.cloudflare_account_id
  name                       = "Pensieve creators"
  domain                     = var.creator_hostname
  type                       = "self_hosted"
  session_duration           = "12h"
  allowed_idps               = var.allowed_identity_provider_ids
  http_only_cookie_attribute = true
  policies = [
    { id = cloudflare_zero_trust_access_policy.agents.id, precedence = 1 },
    { id = cloudflare_zero_trust_access_policy.creators.id, precedence = 2 }
  ]
  lifecycle { prevent_destroy = true }
}
resource "cloudflare_dns_record" "creator" {
  count      = var.create_creator_dns ? 1 : 0
  zone_id    = var.cloudflare_zone_id
  name       = var.creator_hostname
  content    = var.railway_cname_target
  type       = "CNAME"
  ttl        = 1
  proxied    = true
  depends_on = [cloudflare_zero_trust_access_application.creator]
}
resource "cloudflare_turnstile_widget" "reader" {
  account_id = var.cloudflare_account_id
  name       = "Pensieve recipient verification"
  domains    = [var.reader_hostname]
  mode       = "managed"
}
