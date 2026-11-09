# Install on another laptop

## Use the hosted app
Open https://pensieve.doctorew.com and sign in with the account that has pool membership. No database, AWS credentials, Terraform or local model is needed to use the hosted service. Drew's .com account has writer access to the pensive pool and is the sole platform administrator. Each colleague signs in as themselves and receives appropriate pool access.

## Connect Codex without cloning
With Codex installed:

```sh
codex mcp add pensieve --url https://pensieve.doctorew.com/mcp
codex mcp login pensieve
```

Complete Pensieve authorization in your browser. Start a fresh Codex conversation and ask: “Use Pensieve to list my pools, then recall the build decisions from pensive.” The setup instructions are also in web/connect.js. Claude and ChatGPT setup guides: https://pensieve.doctorew.com/connect. Host support/account settings vary; the live MCP protocol has been tested with the official SDK, not every host UI.

## Install the CLI from source
Prerequisites: Git, Node.js 24 LTS and pnpm 10. Node.js 22.13+ is supported by the package, but 24 matches the AWS runtime. On macOS/Linux:

```sh
git clone --branch deploy/aws https://github.com/doctor-ew/pensieve.git
cd pensieve
pnpm install --frozen-lockfile
pnpm build
bash scripts/install-local.sh
```

The installer adds the pensieve launcher under ~/.local/bin, the Codex skill and Claude Code slash command. It preserves conflicting existing files rather than overwriting them. Keep the clone: the launcher points to its built executable. Add ~/.local/bin to your shell PATH if needed. Windows users can run node dist/cli.js directly or use the shell installer under WSL. Sources: package.json, scripts/install-local.sh.

For CLI access to the hosted pool, sign in to the website, select a pool, expand “Connect a terminal or agent,” and create your personal credential. Creating one rotates that account's previous personal credential. OAuth MCP connections are a separate route. Set PENSIEVE_TEAM_TOKEN privately in the terminal environment, then:

```sh
pensieve connect https://pensieve.doctorew.com
pensieve team-pools
```

Do not paste credentials into a repository, shared chat or command checked into Git. The connection is stored privately in ~/.pensieve/team-connection.json. Hosted embeddings run on the server; Ollama is only needed if you choose local embedding workflows. Sources: src/team-cli.ts, src/team-client.ts, docs/TEAM-SETUP.md.

## Update an existing clone
Commit or otherwise preserve your own changes before switching branches. Fetch origin, switch to deploy/aws, fast-forward pull, then rerun pnpm install --frozen-lockfile and pnpm build. Do not reset a dirty checkout.

## Deployment boundaries
Cloning does not provision AWS. Terraform state, real tfvars, credentials and memory databases are intentionally excluded. Pushes to deploy/aws run validation/package workflows and an OIDC-authenticated Terraform plan. Only explicit workflow-dispatch terraform-apply is eligible to update the existing Lambda functions; the workflow rejects other infrastructure mutations. See .github/workflows/aws-deploy.yml and infra/aws-serverless/README.md.
