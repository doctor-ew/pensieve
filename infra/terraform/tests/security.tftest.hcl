mock_provider "cloudflare" {}
mock_provider "aws" {
  mock_resource "aws_sesv2_email_identity" {
    defaults = {
      arn                     = "arn:aws:ses:us-east-1:123456789012:identity/mail.example.com"
      dkim_signing_attributes = { tokens = ["one", "two", "three"] }
    }
  }
}
variables {
  email_route53_zone_id         = "ZFIXTURE"
  cloudflare_account_id         = "fixture-account"
  cloudflare_zone_id            = "fixture-zone"
  creator_hostname              = "pensieve.example.com"
  railway_cname_target          = "fixture.up.railway.app"
  reader_hostname               = "reader.example.com"
  cloudflare_team_domain        = "fixture.cloudflareaccess.com"
  allowed_identity_provider_ids = ["fixture-otp"]
  aws_region                    = "us-east-1"
  sending_domain                = "mail.example.com"
  sender_email                  = "share@mail.example.com"
}
run "secure_defaults" {
  command = apply
  assert {
    condition     = length(cloudflare_dns_record.creator) == 0
    error_message = "DNS cutover must be explicitly enabled after origin protection."
  }
  assert {
    condition     = cloudflare_zero_trust_access_policy.creators.decision == "allow" && one(cloudflare_zero_trust_access_policy.creators.include).login_method.id == "fixture-otp"
    error_message = "Human access must require the selected verified-email login method."
  }
  assert {
    condition     = aws_sesv2_email_identity_mail_from_attributes.sender.behavior_on_mx_failure == "REJECT_MESSAGE"
    error_message = "Do not silently fall back on mail-from failure."
  }
  assert {
    condition     = jsondecode(aws_iam_user_policy.sender.policy).Statement[0].Condition.StringEquals["ses:FromAddress"] == var.sender_email
    error_message = "Sender permission must constrain From address."
  }
}
