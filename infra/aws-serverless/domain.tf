locals { prepare_domain = var.prepare_custom_domain || var.activate_custom_domain }
resource "aws_acm_certificate" "creator" {
  count             = local.prepare_domain ? 1 : 0
  domain_name       = var.creator_hostname
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}
resource "aws_route53_record" "validation" {
  for_each = local.prepare_domain ? { for dvo in aws_acm_certificate.creator[0].domain_validation_options : dvo.domain_name => { name = dvo.resource_record_name, record = dvo.resource_record_value, type = dvo.resource_record_type } } : {}
  zone_id  = var.route53_zone_id
  name     = each.value.name
  type     = each.value.type
  ttl      = 300
  records  = [each.value.record]
}
resource "aws_acm_certificate_validation" "creator" {
  count                   = local.prepare_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.creator[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}
resource "aws_apigatewayv2_domain_name" "creator" {
  count       = local.prepare_domain ? 1 : 0
  domain_name = var.creator_hostname
  domain_name_configuration {
    certificate_arn = aws_acm_certificate_validation.creator[0].certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}
resource "aws_apigatewayv2_api_mapping" "creator" {
  count       = local.prepare_domain ? 1 : 0
  api_id      = aws_apigatewayv2_api.app.id
  domain_name = aws_apigatewayv2_domain_name.creator[0].id
  stage       = aws_apigatewayv2_stage.app.id
}
resource "aws_route53_record" "creator" {
  count   = var.activate_custom_domain ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.creator_hostname
  type    = "A"
  alias {
    name                   = var.enable_cloudfront ? aws_cloudfront_distribution.pensieve[0].domain_name : aws_apigatewayv2_domain_name.creator[0].domain_name_configuration[0].target_domain_name
    zone_id                = var.enable_cloudfront ? aws_cloudfront_distribution.pensieve[0].hosted_zone_id : aws_apigatewayv2_domain_name.creator[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
