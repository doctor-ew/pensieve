# Hosted Pensieve onboarding

Use [Pensieve](https://pensieve.doctorew.com) for memories and
[Connect your AI](https://pensieve.doctorew.com/connect) for agent setup. Hosted users
do not provision AWS or install a database or MEX. Repository knowledge consumers do
not need the source checkout. [Hosted setup](INSTALL-ANOTHER-LAPTOP.md#use-the-hosted-app),
[repository access](REPOSITORY-SYNC.md#L6).

## Where account creation and sign-in happen

| Starting point | Supported entry | Where identity is completed |
| --- | --- | --- |
| Web browser | **Create account** or **Sign in** on Pensieve | Hosted browser identity page, then back to Pensieve. |
| Terminal CLI | `pensieve connect https://pensieve.doctorew.com` | Browser sign-in and approval; the waiting terminal receives the result. |
| Local Pensieve MCP adapter | Ask the agent to call `connect_pensieve` | The tool returns a link for you to open and approve; retry the original tool afterward. |
| Native remote MCP in a chat app or IDE | Add the Pensieve MCP URL in the host's connector settings, then authorize | The host starts browser OAuth and receives its own connection. Availability depends on the app, account and workspace policy. |

Sources: [web account routes](../src/identity-routes.ts#L31),
[CLI browser flow](../src/team-cli.ts#L35), [local MCP tool](../src/team-service.ts#L52),
[remote consent redirect](../src/connector-auth.ts#L56).

There is no separate password-based account-creation CLI or MCP tool. New users can
create their account at [Create account](https://pensieve.doctorew.com/auth/signup),
then start or retry the terminal/agent connection. Account creation and email
verification happen in the browser, not by sending a password or verification code to
the chat. The local `connect_pensieve` tool is not an unauthenticated tool on the remote
MCP endpoint; native remote clients must perform their connector authorization first.
[CLI surface](../src/team-cli.ts#L11), [local tool registration](../src/team-service.ts#L52),
[identity callback](../src/identity-routes.ts#L31).

For ChatGPT, follow the [official custom MCP app instructions](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-apps-in-chatgpt-beta);
use ChatGPT web for setup where instructed, rather than assuming a desktop app has
identical controls. For Claude, use the [custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).
For Cursor, use its [MCP documentation](https://prod.cursor.com/docs/mcp).
These are supported protocol routes and provider instructions, not a claim that every
Pensieve flow has been verified in each desktop application. Test pool listing and
recall in the actual host after authorization. [Verification limits](admin-oversight/DEPLOY.md#remaining-limits).

## 1. Sign in and choose your pool

Open the app and use **Create account** if you need an account, or **Sign in** if you
already have one. Use your own account on each machine. A new account does not inherit
another person's pools. [Sign-in controls](../web/team.html#L3),
[authorization](../src/aws-team-store.ts#L35).

Create a private pool for yourself, or a shared pool for collaboration. To join an
existing shared pool, give its owner the member ID displayed after sign-in. The owner
opens **Team members**, enters that ID, and grants **Read and download** or
**Save and share**. Only owners can grant access; private pools cannot add members.
[Pool controls](../web/team.html#L5), [membership controls](../web/team.html#L12),
[membership enforcement](../src/aws-team-store.ts#L47).

## 2. Connect your AI

Open [Connect your AI](https://pensieve.doctorew.com/connect), select your host and follow
its instructions. The remote MCP address is **https://pensieve.doctorew.com/mcp**.
Authorize using the same account that has access to the intended pool. Host/account
support varies; a setup guide is not proof every host UI has been tested.
[Provider guides and verification labels](../web/connect.js#L4).

For a terminal or local stdio agent, follow [renewable CLI sign-in](INSTALL-ANOTHER-LAPTOP.md#sign-in-with-the-cli).
Do not distribute your personal credential or saved connection to colleagues.
[Connection identity and refresh](../src/agent-connection.ts#L90).

## 3. Verify inside the agent

Ask the agent to list your Pensieve pools, select the intended pool, then recall a
known decision by its topic. Inspect the returned text and citations. If you want to
test writing, explicitly ask it to save a small test memory into that pool, index it,
and recall it. Writer access is required for saving and indexing. A browser success
page, reachable service or queued indexing result alone is not proof of remote recall.
[Memory tools](../src/team-service.ts), [index authorization](../src/aws-team-store.ts#L91),
[service check](../web/connect.js#L16).

## Recover a connection or missing memory

| Symptom | What to do |
| --- | --- |
| Browser works, but the agent cannot access memories | Check the agent's own sign-in, server and account. Then list pools inside that agent. Browser and agent connections are separate. |
| Old personal credential returns 401 | Remove explicit `PENSIEVE_TEAM_TOKEN` from the terminal or agent configuration and reconnect using browser sign-in. Never paste keys into chat. |
| `SIGN_IN_REQUIRED` | For the local Pensieve MCP adapter, invoke `connect_pensieve`, open the returned link and retry. For the CLI, run `pensieve connect`. For a native remote connector, use its reconnect/login action. |
| Connected in browser, but an old local MCP process still fails | After upgrading the adapter, reload its MCP connection or restart the host once. Subsequent sign-in and normal renewal are loaded by the updated adapter without a process restart. |
| Pool is missing or a write is denied | Verify account and destination. Ask the pool owner to check membership; readers cannot save or index. |
| Saved memory does not appear in search | Verify the pool and save receipt, request indexing with writer access, then retry recall after indexing finishes. Repository status distinguishes published from indexed. |
| Repeated manual indexing | The recent-run cooldown succeeds without creating a duplicate job. A successful response still does not mean a pending job is finished. |
| Rate limit or temporary service failure | Back off and retry. Serialize bulk repository publications from the same network; reconnecting repeatedly does not resolve throttling. |

Sources: [connection selection](../src/team-cli.ts#L13),
[recovery and process reload](TEAM-SETUP.md#recover-a-terminal-agent-connection),
[refresh and 401 handling](../src/agent-connection.ts#L90),
[pool access](../src/aws-team-store.ts#L35), [index cooldown](../src/aws-team-store.ts#L91),
[publication pacing and receipts](REPOSITORY-SYNC.md#L28),
[repository status tool](../src/repository-protocol.ts#L30).

## Share with people

For continuing collaboration, grant shared-pool membership as above. For a selected
snapshot, use **Share selected memories**, choose **Only invited emails** or
**Anyone with the complete link**, review the brief and expiry, and create private
invitations. Snapshot access is separate from pool membership. Revoke shares separately;
already downloaded copies cannot be recalled. [Sharing controls](../web/team.html#L11).

## Accounts, activity and support

The platform owner can open [Administration](https://pensieve.doctorew.com/auth/login?returnTo=/admin)
using **drew@doctorew.com**. **Accounts** lists Pensieve application accounts and active
or suspended status. **Activity** filters recorded metadata by UTC date, account, pool
or share and retains it for 30 days. It is not a complete connection-success dashboard:
MCP read auditing and some membership/policy events remain incomplete. Automatic
administrator email alerts are not enabled. [Admin UI](../web/admin.html#L1),
[coverage limits](admin-oversight/DEPLOY.md#remaining-limits).

For support, report the host, time/timezone, exact error, intended pool and whether pool
listing works. Do not include tokens, callback codes or private memory text.
