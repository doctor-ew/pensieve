# Share with someone

## Sender

Open your pool and click **Share with someone**. Choose the whole pool or your
selected memories, edit the executive brief, enter invited email addresses, and
choose an expiry. Click **Create private link**, then **Email invitation** beside
the recipient. Your normal email app opens a ready-to-send draft. Press Send there.
You can also copy the private link into an email yourself. No external email
provider is required for this path; Pensieve does not claim the draft has been sent.
[Owner UI](../web/app.js), [share creation](../src/server.ts).

The starting brief is a set of source excerpts, explicitly labeled in the dialog.
Review and edit it before sharing. This version does not generate a synthesized
executive summary automatically. The underlying snapshot includes all selected
memory text and source metadata, not just the brief. [Draft](../src/executive.ts).

Use **Manage shares → Revoke access** to end access immediately. Links expire
automatically after the chosen 1–30 days. A share is a snapshot, so later captures
are not silently added. Revocation cannot recall copies already saved by a
recipient. [Access controls](../src/executive.ts), [reader server](../src/share-server.ts).

## Recipient

Open the complete private invitation link. Read the brief, expand supporting
memories, or ask a question. Anyone holding the invitation link can access the
snapshot until expiry or revocation; do not forward it. Email ownership is not
independently verified in invitation-link mode. No install,
terminal, account creation, or embedding setup is required.
[Reader](../web/reader.html), [sign-in flow](../web/reader.js).

Questions return matching source excerpts by default. Generated answers are
available only when the sender enables cloud answers for that share **and** the
operator configures a model and key. Generated answers must cite IDs from the
retrieved shared passages; this validates citation membership, not factual
entailment. Hosted retrieval currently uses keyword matching, while the sender’s
private pool retains vector search. [Answer implementation](../src/executive.ts).

## Terminal and agent shortcuts

Use `pensieve open hack-her-thon`, `pensieve share hack-her-thon`, or
`pensieve pack hack-her-thon`. The first two open the browser; `pack` creates a
portable file for another machine. `pensieve pools` lists your registered pools.
Register a pool once with `pensieve register NAME --home PATH --project PROJECT`.
[CLI](../src/cli.ts), [pool registry](../src/pools.ts).

The repository provides a [Codex skill](../skills/pensieve/SKILL.md) for
`$pensieve` and a [Claude Code command](../integrations/claude/pensieve.md) for
`/pensieve`. Shell commands use `pensieve`, without a slash.

## One-time operator setup

Deploy the repository’s [Dockerfile](../Dockerfile) with a persistent volume at
`/data` and an HTTPS domain. [railway.json](../railway.json) supplies the build and
health-check configuration. Configure:

| Variable | Purpose |
| --- | --- |
| `PENSIEVE_OWNER_TOKEN` | Random secret of at least 32 characters; only the sender gets this. |
| `PENSIEVE_PUBLIC_URL` | The service’s HTTPS origin. |
| `RESEND_API_KEY` | Optional credential for the alternate email-code sign-in mode. |
| `PENSIEVE_EMAIL_FROM` | Optional approved sender for email-code sign-in. |
| `PORT` | Listening port supplied by the host. |
| `OPENAI_API_KEY` | Optional credential for consented generated answers. |
| `PENSIEVE_ANSWER_MODEL` | Optional explicitly chosen OpenAI chat model. |

Then use **Sharing settings** in the sender’s UI to save the HTTPS service URL and
owner key. Credentials remain in local settings and never enter shared bundles or
recipient pages. Recipients never need this setup. Environment variables
`PENSIEVE_SHARE_URL` and `PENSIEVE_SHARE_TOKEN` can override local settings.
[Settings](../src/pools.ts), [client](../src/share-client.ts).

The alternate email-code mode uses [Resend’s send API](https://resend.com/docs/api-reference/emails/send-email).
The sign-in code is hashed at rest, expires after ten minutes, is single-use, and
allows five verification attempts. Email-code access tokens expire after twelve hours or
the share expiry, whichever comes first. Private invitation tokens instead last
until the share expires or is revoked, allowing the recipient to revisit the
email on another device. Tokens are hashed at rest and carried in the invitation
URL fragment rather than its path or query. Both content and question requests
recheck revocation. [Implementation](../src/executive.ts).

This is a single-owner service. It does not provide multiple publisher accounts,
automatic secret redaction, at-rest encryption, or an invitation email campaign.
The service stores only deliberately published snapshots. Never mount a private
memory pool as the hosted share directory. [Reader server](../src/share-server.ts).
