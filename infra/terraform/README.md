# Pensieve infrastructure

Status: code only; no infrastructure applied. Terraform 1.17.1, Cloudflare 5.28.1 and AWS 6.72.0 are pinned. Main module manages Access application/policies/service token, optional creator CNAME, Turnstile, SES identity/DKIM/mail-from/DMARC, and a sender-only IAM user. Existing Railway services and volumes remain managed separately; this module does not claim ownership of them.

Approved deployment: pensieve.doctorew.com, open verified-email signup, private memory pools by default, share@mail.doctorew.com, us-east-1. AWS read-only discovery on 2026-11-07 confirmed the doctorew profile has production SES enabled and doctorew.com verified. The dedicated mail.doctorew.com identity/DNS still needs provisioning and verification.

## Authentication and state

Use AWS_PROFILE=doctorew and a scoped CLOUDFLARE_API_TOKEN in the operator environment, never committed or pasted into chat. Cloudflare needs account Access Apps/Policies, Service Tokens, Turnstile write and the doctorew.com zone DNS write permissions; identity-provider discovery needs read permission. Select the One-time PIN identity provider explicitly. Allowing any OTP-authenticated email is intentional public signup, not an internal employee allowlist. App ACLs still isolate memory pools.

Bootstrap the encrypted, versioned, public-blocked S3 state bucket with ../state-backend, supplying bucket_name and aws_region. Keep its initial local state private/backed up. Main state includes Cloudflare service-token and Turnstile secrets even though outputs are sensitive; restrict bucket access. Copy backend.hcl.example to ignored backend.hcl and terraform.tfvars.example to ignored terraform.tfvars, filling discovered account/zone/OTP IDs and Railway's exact custom-domain CNAME target. Initialize using terraform init -backend-config=backend.hcl. S3 native lockfiles are enabled in the example. Do not apply with a local or public backend.

## Verification and activation

Offline checks: terraform init -backend=false, terraform fmt -check -recursive, terraform validate, terraform test. Tests use mock providers and do not provision cloud resources.

Register the creator custom domain with the existing Railway service and capture its DNS target; preserve the old Railway reader hostname for existing links. Run terraform plan -out=deployment.tfplan and inspect it before terraform apply deployment.tfplan. Initial create_creator_dns=false keeps cutover disabled. Verify SES DKIM and mail-from DNS readiness before enabling sending. Configure Railway from application_environment plus sensitive outputs through deployment secrets; never print them to logs. The IAM user has only identity-scoped SendEmail and an exact FromAddress condition. No IAM access key is created by Terraform: provision its runtime secret through the deployment secret store, not an administrator credential.

Deploy origin Access validation and PENSIEVE_OPEN_SIGNUP=true before enabling creator DNS. Confirm missing/forged Access assertions cannot reach creator APIs directly at the Railway origin, OTP signup succeeds, separate users see separate pools, logout remains signed out, and old reader links still work. Then explicitly enable create_creator_dns and apply its reviewed plan. No CI workflow automatically applies infrastructure. Cloudflare account authentication is currently unavailable to this agent; activation remains pending.

Email invitation quotas are application enforced; verified signup does not permit arbitrary email contents or destinations. SES sandbox status is regional. Downloaded memories cannot be recalled by revoking a link.

Sources: [Cloudflare OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/), [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/), [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), [S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3).
