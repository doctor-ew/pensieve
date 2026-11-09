# Pensieve AWS serverless

See [the deployment and cost runbook](../../docs/aws-serverless/INFRA.md). This module is independent of the older Railway/Cloudflare and hosted-PostgreSQL modules. Use its own remote-state key. Defaults do not switch production DNS. Validate with Terraform 1.17.1 and AWS provider 6.72.0; tests use mocked providers only.
