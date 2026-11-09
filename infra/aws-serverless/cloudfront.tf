variable "enable_cloudfront" {
  type        = bool
  default     = false
  description = "Dedicated Pensieve edge distribution. Does not change root-domain records or distributions."
}
variable "existing_waf_arn" {
  type        = string
  default     = "arn:aws:wafv2:us-east-1:432230020714:global/webacl/CreatedByCloudFront-67c309d9-d8d7-424d-9aa3-82434201127f/9a9c7c50-9467-4ef3-8782-841f2f0a4b42"
  description = "Existing CloudFront-scope ACL association only; this module never manages its rules."
  validation {
    condition     = can(regex("^arn:aws:wafv2:us-east-1:[0-9]{12}:global/webacl/", var.existing_waf_arn))
    error_message = "Provide a CloudFront-scope WAF ARN in us-east-1."
  }
}
resource "random_password" "edge" {
  count   = var.enable_cloudfront ? 1 : 0
  length  = 48
  special = false
}
# Once live, alternate CloudFront hostnames must not bypass host-scoped WAF rules.
resource "aws_cloudfront_function" "canonical_host" {
  count   = var.enable_cloudfront && var.activate_custom_domain ? 1 : 0
  name    = "${local.name}-canonical-host"
  runtime = "cloudfront-js-2.0"
  comment = "Reject alternate hostnames before forwarding to the Pensieve origin"
  publish = true
  code    = <<-JAVASCRIPT
    function handler(event) {
      var request = event.request;
      var host = request.headers.host;
      if (!host || typeof host.value !== 'string' || host.value.toLowerCase() !== ${jsonencode(lower(var.creator_hostname))}) {
        return {
          statusCode: 403,
          statusDescription: 'Forbidden',
          headers: { 'cache-control': { value: 'no-store' } }
        };
      }
      return request;
    }
  JAVASCRIPT
}
resource "aws_cloudfront_distribution" "pensieve" {
  count               = var.enable_cloudfront ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Pensieve only: private memory and authentication responses are never cached"
  price_class         = "PriceClass_100"
  web_acl_id          = var.existing_waf_arn
  wait_for_deployment = true
  aliases             = local.prepare_domain ? [var.creator_hostname] : []
  origin {
    origin_id   = "pensieve-api"
    domain_name = trimprefix(aws_apigatewayv2_api.app.api_endpoint, "https://")
    custom_header {
      name  = "x-pensieve-edge-token"
      value = random_password.edge[0].result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
  }
  default_cache_behavior {
    target_origin_id         = "pensieve-api"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
    compress                 = true
    dynamic "function_association" {
      for_each = aws_cloudfront_function.canonical_host
      content {
        event_type   = "viewer-request"
        function_arn = function_association.value.arn
      }
    }
  }
  # CloudFront error caching has a separate TTL from the cache policy.
  dynamic "custom_error_response" {
    for_each = toset([400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504])
    content {
      error_code            = custom_error_response.value
      error_caching_min_ttl = 0
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = !local.prepare_domain
    acm_certificate_arn            = local.prepare_domain ? aws_acm_certificate_validation.creator[0].certificate_arn : null
    ssl_support_method             = local.prepare_domain ? "sni-only" : null
    minimum_protocol_version       = local.prepare_domain ? "TLSv1.2_2021" : "TLSv1"
  }
  lifecycle {
    precondition {
      condition     = !local.prepare_domain || var.aws_region == "us-east-1"
      error_message = "CloudFront custom hostname requires the ACM certificate in us-east-1."
    }
  }
}
output "cloudfront_url" {
  value = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.pensieve[0].domain_name}" : null
}
