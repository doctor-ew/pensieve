# Scope and drift

Implementation follows docs/hosted-platform/SPEC.md and GitHub issue #8. Additions needed to complete the specified behavior: packaged SQL migrations in Docker/npm, explicit migration CLI, identity route module after independent review, advanced personal credential issuance for Cognito users, share pagination, and repeatable disposable restore script. Mermaid diagrams are included both inline and as architecture.mmd, login.mmd and sharing.mmd.

No production database or hostname cutover, no Cloudflare migration, no new CloudFront service, and no replacement of local SQLite mode. Existing share IDs and hashes are migrated without regeneration. Railway database provisioning and scheduled production backups are explicitly outstanding rollout work; Terraform declares AWS identity/DNS and references the existing SES resources.
