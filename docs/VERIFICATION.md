# Verification — 2026-11-06

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
