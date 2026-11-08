variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "creator_hostname" {
  type    = string
  default = "pensieve.doctorew.com"
  validation {
    condition     = can(regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+$", var.creator_hostname))
    error_message = "Use a DNS hostname without scheme, wildcard, path or port."
  }
}
variable "route53_zone_id" { type = string }
variable "railway_cname_target" {
  type        = string
  description = "Exact target from Railway custom-domain registration."
}
variable "create_creator_dns" {
  type        = bool
  default     = false
  description = "Enable only after migration, Cognito wiring and Railway TLS readiness checks."
}
variable "cognito_domain_prefix" {
  type        = string
  description = "Unique prefix for Cognito's managed-login hostname."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$", var.cognito_domain_prefix))
    error_message = "Use a unique lowercase DNS label (2 to 63 characters)."
  }
}
variable "ses_identity_arn" {
  type        = string
  description = "Existing verified SES identity ARN in the configured region; not managed by this module."
  validation {
    condition     = can(regex("^arn:aws:ses:[a-z0-9-]+:[0-9]{12}:identity/[^ ]+$", var.ses_identity_arn))
    error_message = "Provide an existing SES identity ARN."
  }
}
variable "sender_email" {
  type    = string
  default = "share@mail.doctorew.com"
}
