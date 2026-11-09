variable "aws_region" { default = "us-east-1" }
variable "environment" {
  type    = string
  default = "aws"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.environment))
    error_message = "Environment must be a short lowercase name."
  }
}
variable "creator_hostname" { default = "pensieve.doctorew.com" }
variable "route53_zone_id" { type = string }
variable "activate_custom_domain" {
  type        = bool
  default     = false
  description = "Final cutover gate. Creates hostname and sets runtime public origin after staging proof."
}
variable "prepare_custom_domain" {
  type        = bool
  default     = false
  description = "Creates ACM certificate/custom API domain without moving creator DNS."
}
variable "ses_identity_arn" { type = string }
variable "sender_email" { default = "share@mail.doctorew.com" }
variable "owner_token_parameter" {
  type        = string
  description = "Existing SSM SecureString parameter name. Value never enters Terraform state."
  validation {
    condition     = startswith(var.owner_token_parameter, "/pensieve/")
    error_message = "Use a parameter under /pensieve/."
  }
}
variable "lambda_zip" {
  type        = string
  description = "Absolute path to scripts/build-aws.mjs output."
}
variable "embedding_model" { default = "amazon.titan-embed-text-v2:0" }
variable "embedding_dimensions" {
  type    = number
  default = 256
  validation {
    condition     = contains([256, 512, 1024], var.embedding_dimensions)
    error_message = "Titan v2 dimension must be 256, 512 or 1024."
  }
}
variable "read_capacity" { default = 5 }
variable "write_capacity" { default = 5 }
variable "api_concurrency" { default = 5 }
variable "worker_concurrency" { default = 2 }
variable "enable_workers" {
  type        = bool
  default     = true
  description = "Disable while importing frozen source state, then enable after migration proof."
}
variable "monthly_budget_usd" {
  type    = number
  default = 20
  validation {
    condition     = var.monthly_budget_usd > 0 && var.monthly_budget_usd <= 25
    error_message = "Budget must be positive and at most the approved $25 ceiling."
  }
}
variable "budget_emails" {
  type        = list(string)
  description = "Operator destinations for budget notifications."
  validation {
    condition     = length(var.budget_emails) >= 1 && length(var.budget_emails) <= 10
    error_message = "Provide at least one and no more than ten notification addresses."
  }
}
