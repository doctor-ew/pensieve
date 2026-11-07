resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.sending_domain
  dkim_signing_attributes { next_signing_key_length = "RSA_2048_BIT" }
  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = endswith(var.sender_email, "@${var.sending_domain}")
      error_message = "The sender email must belong to the configured sending domain."
    }
  }
}
resource "aws_route53_record" "dkim" {
  count   = 3
  zone_id = var.email_route53_zone_id
  name    = "${aws_sesv2_email_identity.sender.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.sending_domain}"
  type    = "CNAME"
  ttl     = 300
  records = ["${aws_sesv2_email_identity.sender.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}
resource "aws_sesv2_email_identity_mail_from_attributes" "sender" {
  email_identity         = aws_sesv2_email_identity.sender.email_identity
  mail_from_domain       = "bounce.${var.sending_domain}"
  behavior_on_mx_failure = "REJECT_MESSAGE"
}
resource "aws_route53_record" "mail_from_mx" {
  zone_id = var.email_route53_zone_id
  name    = "bounce.${var.sending_domain}"
  type    = "MX"
  ttl     = 300
  records = ["10 feedback-smtp.${var.aws_region}.amazonses.com"]
}
resource "aws_route53_record" "mail_from_spf" {
  zone_id = var.email_route53_zone_id
  name    = "bounce.${var.sending_domain}"
  type    = "TXT"
  ttl     = 300
  records = ["v=spf1 include:amazonses.com -all"]
}
resource "aws_route53_record" "dmarc" {
  zone_id = var.email_route53_zone_id
  name    = "_dmarc.${var.sending_domain}"
  type    = "TXT"
  ttl     = 300
  records = ["v=DMARC1; p=reject; adkim=s; aspf=r"]
}
resource "aws_iam_user" "sender" {
  name = var.sender_iam_user_name
  path = "/pensieve/"
}
resource "aws_iam_user_policy" "sender" {
  name = "SendPensieveInvitations"
  user = aws_iam_user.sender.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["ses:SendEmail"]
      Resource  = aws_sesv2_email_identity.sender.arn
      Condition = { StringEquals = { "ses:FromAddress" = var.sender_email } }
    }]
  })
}
# No access key is generated or written to Terraform state. Provision/rotate
# runtime credentials through the deployment secret-management process.
