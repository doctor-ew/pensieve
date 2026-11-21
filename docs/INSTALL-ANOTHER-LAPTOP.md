# Connect another laptop or install the CLI

For account setup, shared-pool access and troubleshooting, start with [Hosted onboarding](ONBOARDING.md).

## Use the hosted app
Open https://pensieve.doctorew.com and sign in with the account that has pool membership. No database, AWS credentials, Terraform or local model is needed to use the hosted service. Drew's .com account has writer access to the pensive pool and is the sole platform administrator. Each colleague signs in as themselves and receives appropriate pool access.

## Connect Codex without cloning
With Codex installed:

```sh
codex mcp add pensieve --url https://pensieve.doctorew.com/mcp
codex mcp login pensieve
```

Source: [shipped Codex setup](../web/connect.js#L7).

Complete Pensieve authorization in your browser. Start a fresh Codex conversation and ask: “Use Pensieve to list my pools, then recall the build decisions from the pool I select.” The setup instructions are also in web/connect.js. Claude and ChatGPT setup guides: https://pensieve.doctorew.com/connect. Host support/account settings vary; the live MCP protocol has been tested with the official SDK, not every host UI.

## Install the CLI from source
Prerequisites: Git, Node.js 24 LTS and pnpm 10. Node.js 22.13+ is supported by the package, but 24 matches the AWS runtime. On macOS/Linux:

```sh
git clone --branch main https://github.com/doctor-ew/pensieve.git
cd pensieve
pnpm install --frozen-lockfile
pnpm build
bash scripts/install-local.sh
```

Sources for the install commands: [package](../package.json#L7), [installer](../scripts/install-local.sh#L1).

The installer adds the pensieve launcher under ~/.local/bin, the Codex skill and Claude Code slash command. It preserves conflicting existing files rather than overwriting them. Keep the clone: the launcher points to its built executable. Add ~/.local/bin to your shell PATH if needed. Windows users can run node dist/cli.js directly or use the shell installer under WSL. Sources: package.json, scripts/install-local.sh.

## Sign in with the CLI

Use renewable browser sign-in. Remove an old explicit token from this terminal first;
otherwise it selects the legacy credential route. Also remove any old
`PENSIEVE_TEAM_TOKEN` from your agent's configuration when switching that agent to OAuth.
[Connection selection](../src/team-cli.ts#L13).

```sh
unset PENSIEVE_TEAM_TOKEN
pensieve connect https://pensieve.doctorew.com --name "My laptop"
pensieve connection-status
pensieve team-pools
```

Source: [CLI commands](../src/team-cli.ts#L30). Approve the connection in your browser,
then return to the terminal. `--no-browser` prints a sign-in link instead. Keep the
command running until the callback completes. If using `--home`, pass the same private
home to every command and to the stdio MCP host. Credentials are stored privately in
that home's `agent-connection.json`; do not copy this file between people or commit it.
Normal expiry renews automatically. [OAuth connection](../src/agent-connection.ts#L90).

A native remote MCP connection and this CLI connection are separate: signing into one
does not configure the other. For a local stdio agent, register
`node /absolute/pensieve/dist/cli.js mcp --home /private/client-home` and connect that
same home. Source: [stdio command](../src/cli.ts#L64); see [agent setup and recovery](TEAM-SETUP.md#agent-tools).

Hosted embeddings run on the server; a local model is only needed for optional local
workflows. [AWS architecture](aws-serverless/ARCHITECTURE.md).

## Update an existing clone
Commit or otherwise preserve your own changes before switching branches. Fetch origin, switch to main, fast-forward pull, then rerun pnpm install --frozen-lockfile and pnpm build. Do not reset a dirty checkout.

## Deployment boundaries
Cloning does not provision AWS. Terraform state, real tfvars, credentials and memory databases are intentionally excluded. Pushes to deploy/aws run validation/package workflows and an OIDC-authenticated Terraform plan. Only explicit workflow-dispatch terraform-apply is eligible to update the existing Lambda functions; the workflow rejects other infrastructure mutations. See .github/workflows/aws-deploy.yml and infra/aws-serverless/README.md.
