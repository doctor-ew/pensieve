# Edge host boundary

After `activate_custom_domain=true`, the viewer-request CloudFront Function admits only the exact lowercase-normalized `creator_hostname`. Other hosts—including the distribution's default `*.cloudfront.net` hostname—receive HTTP 403 with `Cache-Control: no-store`. This prevents the distribution hostname from reaching the origin while evading the Pensieve-host-scoped WAF rules. Before activation, no function is associated, so CloudFront staging remains usable.

The API origin token remains required: the viewer host check and origin authentication protect different entry paths. The host function must stay associated with every cache behavior that can reach the API. There is currently one default behavior. Root website distributions and hostnames are untouched.

Run `terraform test` for association/lifecycle checks and `node tests/edge-host.test.mjs` to execute the actual embedded function against canonical, alternate, spoofed suffix, missing and malformed host values. Live verification after deployment should confirm the canonical hostname works and the default CloudFront hostname returns 403. No live deployment is performed by these tests.

GitHub Terraform refresh additionally needs scoped `cloudfront:DescribeFunction`, `cloudfront:GetFunction`, and `cloudfront:ListTagsForResource` for the new function ARN. Function deployment remains operator-managed.
