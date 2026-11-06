# Verification — 2026-11-06

## v0.2 executive sharing

- Type checking, build, and 16 automated tests passed locally. New checks cover
  recipient isolation, code replay/expiry/lockout, concurrent resend throttling,
  persistent snapshots, revocation, owner/reader separation, named pools, and
  cloud-consent/citation boundaries. [Tests](../test/sharing.test.ts).
- A synthetic browser trial selected one of two memories, created a share,
  verified an invited email using a test mail sink, read the brief, and asked a
  question. The unselected memory was absent. Layout had no horizontal overflow
  at 390px. This was not a live email-delivery test.
  [Fixture](../test/browser-fixture.ts).
- The normal `pensieve` launcher, Codex skill, and Claude command were installed
  locally. The named Hack-Her-Thon pool opened without supplying a path. The
  `pack` command exported two synthetic memories with one command.
  [Installer](../scripts/install-local.sh), [CLI](../src/cli.ts).
- Skill validation passed using the skill-creator validator with PyYAML supplied
  through an isolated `uv run` environment. [Skill](../skills/pensieve/SKILL.md).

Deployment is not certified: Railway authentication was unavailable, and no
sharing-email credentials were configured. Cloud-answer behavior was tested with
a mocked model response, not a live key. The deployment files are prepared, but
there is no remote executive link yet. [Operator setup](EXECUTIVE-SHARING.md).

## Executed locally

- `pnpm check-types`, `pnpm test`, `pnpm build`, and `git diff --check`: passed.
- Eight automated tests: metadata-based project discovery, Codex append/reimport,
  Claude block parsing, cosine ranking/model separation, selective bundle round
  trips and conflict rollback, private/workspace isolation, local API auth/origin
  handling, and authenticated remote bundle exchange.
- Real local Ollama `embeddinggemma` retrieval: three synthetic memories, with the
  database rationale ranked first for a financial-correctness question.
- Browser: loaded pool, semantic search, selected export/download, and no horizontal
  overflow at 390px width. Desktop inspected at 1440px. Fixed the favicon 401
  found during the browser check.

Reproduction: [core tests](../test/core.test.ts), [live smoke](../test/live-smoke.ts),
[package scripts](../package.json). Browser checks used the [local UI](../web/app.js).

## Real-project trial

The isolated Hack-Her-Thon trial discovered 14 matching Codex session paths,
selected three, imported 318 chunks, and indexed them locally. Repeat import
added zero duplicates. No matching Claude logs were found for this project.
Claude parser coverage therefore comes from synthetic tests, not this corpus.

Three questions were inspected: reachable users versus TAM, MVP feature limits
and success criteria, and synthetic versus real evidence. After adding the
model’s documented query/document prefixes, relevant passages ranked first,
third, and first respectively. This is a small inspected trial, not a held-out
retrieval benchmark. The MVP question’s first result remained indirect.

Raw transcripts, embeddings, result excerpts, and the detailed report remain in
the operator’s private evaluation directory, outside the repository. Reproduce
with the [project test walkthrough](PROJECT-TEST.md) and inspect your own results.
No project files were changed by that trial.

## Limits of this evidence

Cloud embeddings were not exercised with a live API key. Shared workspace
exchange was tested over authenticated loopback HTTP; external TLS deployment,
multi-user operational behavior, and backup/restore were not tested. No hosted
workspace has been deployed. See [architecture limits](ARCHITECTURE.md).
