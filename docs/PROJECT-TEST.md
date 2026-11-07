# Test against Hack-Her-Thon

Run from the Pensieve checkout. The target repository remains unchanged: this test
reads session logs whose metadata identifies the project and writes an isolated
private pool outside both repositories. See [the test](../test/project-smoke.ts).

1. Build with `pnpm build`.
2. Run `pnpm exec tsx test/project-smoke.ts /Users/doctorew/shuttlebay/_ATL_/GSU/Hack-Her-Thon /Users/doctorew/.pensieve/evaluations/hack-her-thon`.
3. Inspect the private `report.json` in that pool. It includes source files,
   import counts, retrieved text, scores, and source locators. Do not commit it.
4. Launch `node dist/cli.js serve --home /Users/doctorew/.pensieve/evaluations/hack-her-thon --port 7332`.
5. Open the authenticated URL printed by the CLI. Try the three questions below,
   and compare the results with the original transcript and current project docs.

Command implementations: [project smoke](../test/project-smoke.ts),
[CLI](../src/cli.ts). This bounded test selects the last three lexically sorted
session paths per source. It does not claim to cover every session or prove that
every supported source has local data.

## Recall checks

| Question | What to inspect |
| --- | --- |
| Why count reachable users instead of total addressable market? | A relevant discussion of reachable people; matching session and project references. |
| How many MVP features, and how is success measured? | A relevant constraint and measurable experiment; distinguish historical guidance from the current prompt. |
| How do synthetic exercises differ from real fieldwork? | Explicit synthetic labels and uncertainty; no promotion of scenario counts into observed facts. |

The script records top-five results and automatically checks project provenance
and repeat-import idempotency. Retrieval relevance still needs human inspection.
Current project files are comparison material, not session memories imported by
this test. [Test implementation](../test/project-smoke.ts).

## Sharing check

Use synthetic memories for a public sharing demonstration. Select exactly one,
export a bundle, and import it into a fresh pool. Verify the exported memory is
present and an unselected memory is absent. Automated bundle and hosted-workspace
tests cover those boundaries without sharing real project conversations.
[Tests](../test/core.test.ts).

## Live capture

Use `pensieve discover codex --project /Users/doctorew/shuttlebay/_ATL_/GSU/Hack-Her-Thon`
to locate matching session paths, then run
`pensieve watch codex /path/from/discovery.jsonl --home /Users/doctorew/.pensieve/evaluations/hack-her-thon`.
Substitute `claude` for a Claude Code session. Run `pensieve index --home /Users/doctorew/.pensieve/evaluations/hack-her-thon`
after new messages arrive. Watching captures text; embedding remains a separate,
explicit operation. [CLI](../src/cli.ts), [discovery](../src/sessions.ts).

## Import the actual project

The smoke-test pool above is only a sample, not the project memory pool. To import
tracked Markdown materials and **all** sessions with matching project metadata:

```sh
pensieve import-project --project /path/to/project --home /path/to/new-private-pool
pensieve index --home /path/to/new-private-pool
```

Use a new directory to preserve an old sample. Import reports document/session
counts, revision, and parse warnings. Repository passages retain file locations;
session passages retain transcript locations. Generated AGENTS/environment
messages are skipped before chunking. Review the scope and prepare a grounded
executive brief before sharing; synthetic exercises remain historical examples.
