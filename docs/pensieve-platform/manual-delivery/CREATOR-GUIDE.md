# Create and share memories in the browser

This guide describes the new team creator interface. Your operator must start the **team server** and send you a personal invitation. Existing recipient-only share links open a snapshot; they are not creator invitations. This implementation has been tested locally with synthetic data and has not been deployed to Railway by this delivery.

## Get started

1. Open your personal invitation. Pensieve signs you in and removes the secret from the address bar. Do not forward that invitation or use an operator key.
2. Create a named memory pool. Choose **Only me** for a private pool or **Shared with invited team members** for collaboration. A shared pool is visible only to members you grant access to.
3. Paste useful reasoning, decisions or an original excerpt. You can also load a text/Markdown file or a Pensieve JSON bundle. Review the text before saving. Choose **Original excerpt** for raw material; select **Reasoning and decisions** only when you have actually distilled it.
4. Add the source project, conversation reference and citation when known. Mark demonstration material **Synthetic**. Click **Save memory** and wait for **Ready**. A failed save is reported at the top; check it before retrying.

A Pensieve JSON bundle that is saved without changing its preview preserves record IDs and provenance. Editing that preview creates one new reviewed memory instead. The prototype accepts text/Markdown and Pensieve v1 JSON; it does not parse every provider's account export format.

## Hand an idea to someone

Check the memories for this audience. Write a short reviewed brief that explains the idea, decisions and next step. Enter recipient addresses and expiry, then select **Create private invitations**.

Use **Open email draft** to prepare an email in your own mail application. Review and send it there. Pensieve does not silently send email. **Copy private invitation** lets you share the link another way. The invitation is a bearer secret: anyone holding it can read the selected snapshot until expiry or revocation.

Create separate shares for different audiences. Unselected memories are not included. The recipient can read the brief in their browser and use **Download for an agent** to take the selected memories to another machine. The downloaded bundle retains source context and provenance; its source attribution is evidence, not authenticated authority on another machine.

Use **Revoke invitation access** to stop future online access. Snapshots are fixed copies, so later pool edits do not update them. Removing a team member does not retroactively revoke their previously issued recipient invitations. Already downloaded copies cannot be remotely recalled.

## Collaborate and control capture

Your personal member ID appears after sign-in. A pool owner can grant an already invited colleague **Read and download** or **Save and share** access using that colleague's ID. Readers cannot save memories, grant access or create hosted invitations. Writers cannot grant access. Private pools cannot add other members.

Under **Capture settings**, the pool owner can choose a default for every member. Writers and owners can save their own exact project/conversation overrides. Overrides replace the whole setting, so private/off does not retain an earlier shared target. The effective saved policy is displayed. With no saved policy, your selected pool is the explicit browser save target.

**Capture off** blocks saving. **Private pool only** saves browser content into an authorized private pool, creating one when needed, and switches the displayed destination. A shared policy targeting another pool causes the server to reject the action rather than publishing to an unexpected location.

The automatic-capture checkbox enables policy for supported terminal watchers or agent inputs. It cannot monitor your Claude/ChatGPT browser conversations. For browser conversations, paste or upload the content you choose; use the documented connector/watcher for other supported inputs.

**Prepare semantic search** indexes the pool with the server's configured embedding provider. **Search memories** uses that provider. Missing provider configuration produces an explicit error; Pensieve does not substitute keyword results while calling them vector search. Provider selection is an operator configuration, not an executive setup task.

## Sign out and revoke access

**Sign out** invalidates the current browser session. Sessions expire after 12 hours and use HttpOnly, SameSite cookies, with Secure on HTTPS. Signing out does not revoke your personal invitation credential. Ask the operator to revoke that identity if the credential is lost or exposed. The operator-only endpoint is `POST /api/team/admin/users/:id/revoke`; other personal identities remain valid.

## Verified locally

`pnpm exec tsx --test test/team-browser.test.ts` launches an isolated browser process and exercises personal invitation sign-in, pool creation, save, selected export, curated share, separate recipient read/download, revoke and logout with synthetic content. It checks that unselected text and operator/creator credentials are absent from downloads and that script-like memory text stays data. The test uses installed macOS Chrome when present; otherwise install Chromium with `pnpm exec playwright install --with-deps chromium`, or set `PENSIEVE_TEST_BROWSER` to an explicit browser executable.

These tests do not establish live Railway deployment, Azure connectivity, email delivery or a signed-in Claude connector handshake. Formal Nightshift gates remain separately blocked; this is manual delivery evidence.
