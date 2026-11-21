# Shared repository knowledge

Pensieve stores MEX-derived repository evidence in its existing authorized memory pools and AWS vector index. Readers use `recall_memories` or ordinary pool search; they do not need a checkout, MEX, or access to the producer's machine. See [repository-knowledge.ts](../../src/repository-knowledge.ts), [aws-runtime.ts](../../src/aws-runtime.ts), and [aws-vectors.ts](../../src/aws-vectors.ts).

## Connect and publish

Install the producer runtime with `npm run setup:mex` from the Pensieve installation. This installs the exact `mex-agent@0.9.0-beta.1.1` lockfile with lifecycle scripts disabled. Only producers need this dependency. See [package.json](../../package.json) and [runtime lockfile](../../runtime/mex/package-lock.json).

Sign in through `pensieve connect https://pensieve.doctorew.com`, then select a pool from `pensieve team-pools`. Register a destination with `pensieve repo-connect NAME --pool POOL_ID`. Keep the returned repository ID: the same ID must be used from either Mac or CI. Publish with `pensieve repo-sync /path/to/repository --repo REPOSITORY_ID`. The web Repository knowledge panel can also register destinations and inspect indexing. See [team-cli.ts](../../src/team-cli.ts), [repository-sync.ts](../../src/repository-sync.ts), and [team.js](../../web/team.js).

For GitHub intake, register with `pensieve repo-connect NAME --pool POOL_ID --project https://github.com/OWNER/REPO.git --branch BRANCH`. Then run `pensieve repo-sync --repo REPOSITORY_ID` without a local path. Private repositories use the producer's explicitly supplied `PENSIEVE_GITHUB_TOKEN`; it is not stored in Pensieve or reused from the Pensieve login. Git clones are temporary bare repositories, redirects and hooks are disabled, and only committed source blobs are extracted. See [repository-sync.ts](../../src/repository-sync.ts).

For automatic updates, include `--auto-refresh` when connecting, then run `pensieve repo-watch [PATH] --repo REPOSITORY_ID`. The producer must remain running. An unchanged commit is not re-extracted. Failures retain the last successful publication. This release does not install a background service or provision an always-on hosted Git scheduler. See [team-cli.ts](../../src/team-cli.ts).

## Publication and freshness

Records are staged in batches. The repository pointer and completed publication marker switch atomically; conflicting producers must retry from the new repository state. Unpublished or superseded records cannot enter ordinary semantic recall. Removed symbols, including an empty source snapshot, disappear from current recall. Historical records remain available for explicit exports/listing. Source text remains untrusted evidence. See [repository-publication.ts](../../src/repository-publication.ts) and [repository-knowledge.ts](../../src/repository-knowledge.ts).

AWS indexing is asynchronous. `published` is not equivalent to searchable. `get_repository_status` reports completion only after comparing per-record vector receipts for the configured embedding model. Retry `team-index` if indexing is pending; a failed request does not undo the durable publication. See [repository-service.ts](../../src/repository-service.ts), [aws-team-store.ts](../../src/aws-team-store.ts), and [repository-protocol.ts](../../src/repository-protocol.ts).

Scope limits are 5,000 supported source files, 25 MB total, 1 MB per file, and 3,000 derived records. Excerpts and relationship lists are explicitly bounded. Unsupported/binary sources, symlinks, generated directories, and hidden paths are not ingested by the producer. The graph export is explicitly tied to MEX schema 4 and fails closed on a changed schema. See [repository-sync.ts](../../src/repository-sync.ts) and [repository-knowledge.ts](../../src/repository-knowledge.ts).

## Validation

[repository-publication.test.ts](../../test/repository-publication.test.ts) runs the real pinned MEX engine, publishes over HTTP, retrieves using another account/client, checks pool isolation and policy, suppresses staged records even when they outnumber query limits, replaces revisions and removes every source file, then verifies retrieval after the producer checkout disappears. Test embeddings are synthetic; this is not a substitute for deployed Bedrock/S3-vector verification.

[aws-vectors.test.ts](../../test/aws-vectors.test.ts) checks active-publication filtering and splits large repository scopes below the documented [S3 Vectors filter constraint limit](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-metadata-filtering.html).
