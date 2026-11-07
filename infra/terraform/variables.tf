variable "cloudflare_account_id" { type = string }
variable "cloudflare_zone_id" { type = string }
variable "creator_hostname" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.creator_hostname))
    error_message = "Use an exact DNS hostname, not a URL or wildcard."
  }
}
variable "railway_cname_target" {
  type        = string
  description = "Exact CNAME target returned by Railway after registering the creator custom domain."
}
variable "reader_hostname" { type = string }
variable "cloudflare_team_domain" {
  type = string
  validation {
    condition     = can(regex("^[a-z0-9-]+\\.cloudflareaccess\\.com$", var.cloudflare_team_domain))
    error_message = "Use the Cloudflare team hostname."
  }
}
variable "allowed_identity_provider_ids" {
  type = set(string)
  validation {
    condition     = length(var.allowed_identity_provider_ids) > 0
    error_message = "Select existing identity providers explicitly."
  }
}
variable "aws_region" { type = string }
variable "sending_domain" {
  type        = string
  description = "Dedicated email subdomain in the configured Route 53 zone; do not reuse existing mail DNS without importing it."
}
variable "email_route53_zone_id" { type = string }
variable "sender_email" { type = string }
variable "sender_iam_user_name" {
  type    = string
  default = "pensieve-mail-sender"
}
variable "create_creator_dns" {
  type        = bool
  default     = false
  description = "Enable only after origin Access validation is deployed and Railway custom-domain registration is verified."
}
