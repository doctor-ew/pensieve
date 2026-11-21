# Shared repository knowledge

Register each repository with `repo-connect`, then publish committed source using
`repo-sync PATH --repo ID`. Run `repo-watch PATH --repo ID --interval 300000`
for automatic publication every five minutes. Add `--home HOME` to select the
saved personal OAuth connection. No personal credential belongs in a launch agent
or shell command. Consumers use the shared pool through Pensieve; they do not need
the source checkout or MEX installed.

Publication captures supported committed source plus Markdown/MDX documents and Swift
text. Swift and documents have cited source evidence only, not semantic symbol
extraction. Uncommitted edits, binaries, dependencies, excluded directories and
unsupported extensions are not uploaded; this is not a complete clone. Extraction runs
in an isolated directory using the pinned MEX engine. A new source revision becomes
current only after every record is accepted. Indexing is asynchronous on AWS;
check repository status and recall before calling a publication searchable.

The current producer uses packed records containing full supported source, symbol catalogs, and non-containment
relationships with confidence and resolution labels. Qualified symbol names retain
scope information. Containment edges are not separately exported. Each record is
at most 10,000 characters with revision-bound citations. The 4,000-record cap and
source/graph bounds still apply; an oversized export fails without replacing the
last successful publication. Records may contain sections from several files.

Append and completion operations retry the same immutable evidence with bounded
backoff. The OAuth client reuses its authenticated MCP transport across requests
and closes idle transports after 30 seconds. Bulk batches are spaced by 1.5 seconds
to leave headroom under the hosted IP request limit. Coordinate multiple watched
repositories sequentially when they share a pool or network address. Authentication failures requiring sign-in stop immediately. A terminated
AWS write can retain a temporary pool lease until its 15-minute expiry; watchers
retry on their next cycle while retaining the previous publication. AWS SDK
requests use bounded connection/request timeouts and three standard attempts to
reduce the risk of overrunning the API's 29-second deadline.

Bulk intake can exceed a small provisioned DynamoDB allowance. The module supports
`billing_mode = "PAY_PER_REQUEST"` with explicit maximum read/write request units
(default 1,000 each). This bills actual requests and removes fixed provisioned
capacity; the maxima are throughput limits, not spending caps. Infrastructure
changes require an operator Terraform plan/apply; CI remains limited to Lambda
updates. See [AWS capacity guidance](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-switching-capacity-modes.html).

Every publication returns a coverage receipt with `tracked`, `semantic`, `citedText`,
and a `skipped` list containing each excluded path and its reason. The same inventory
is published as repository evidence. Semantic files missing from the extracted graph
fail the publication. Format-version checks automatically refresh older publications,
even when the Git commit has not changed. Already-current checks return a concise
status instead of repeating the inventory.

Register separate repository connections for branch-specific histories that must
remain independently retrievable; one connection always points to its latest published
snapshot. Publication replacement deliberately hides that connection's old evidence.

## Operational visibility

AWS API and worker logs are in `/aws/lambda/pensieve-aws-api` and
`/aws/lambda/pensieve-aws-worker` in `us-east-1` (seven-day retention). The
`pensieve-aws-worker-failures` CloudWatch alarm monitors failed work in SQS.
The admin audit endpoint records supported account, sharing, and memory actions.
This audit trail is not comprehensive product analytics: HTTP auditing currently
covers selected successful REST operations, not every MCP tool outcome.

For a launchd installation on macOS, use absolute Node/CLI paths, an explicit PATH
for Git, a sequential coordinator for repositories sharing a pool, private local stdout/stderr
logs, RunAtLoad and KeepAlive. User agents operate while that user is logged in and resume after login;
updates pause while the Mac is asleep or offline. Changes on another device become
publishable here after they are committed and fetched into the watched checkout.
