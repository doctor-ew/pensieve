# Pensieve shared-memory creator platform — controller specification

Status: manual takeover specification; independent adversarial review required before implementation. This is NOT a passed Nightshift gate. The original Nightshift run, two provider failures, third diagnostic attempt and failure counters remain under docs/spec-8f6f6abd84603e7b. Source baseline: 6cc24d4 on delivery/pensieve-shared-memory; application code unchanged from 92bc676.

## Product contract

Implement the parent BUILD-BRIEF.md AC-01 through AC-15. User requirements: executives create/save/curate/share useful reasoning; engineers preserve per-repository sessions and exchange memories across devices; configured team pools are shared by default with narrower overrides; SDLC agents retrieve context and write back findings, not grant ticket approval. KSU is deferred. Root DECISIONS.md records reversible defaults separately from user requirements.

## Architecture and boundaries

Preserve legacy local/reader behavior. Add an independently runnable team server with its own SQLite database and creator UI; no migration or mutation of existing private databases is required. The team server is the policy/authorization boundary, while the local CLI can queue and synchronize contributions. All tests use synthetic identities/content. Do not deploy or provision cloud resources.

New code below is proposed, not claimed to exist. Existing identifiers cited under Sources were verified by direct source inspection during controller takeover.

### Identity and pool isolation

An operator bootstrap credential creates invited creator identities only; normal users receive distinct revocable opaque tokens. Store token digests, not raw tokens. Browser sign-in exchanges a personal token for an HttpOnly same-site session cookie; API/agent clients use personal bearer tokens. Never expose the operator key in UI, agent configuration or exports. Each pool has owner/writer/reader membership. Private pools cannot grant other members; shared pools require explicit membership. All listing, retrieval, vector search, mutations, member changes, export and share operations check membership before data access. Owner may grant existing users membership; writers contribute; readers cannot mutate. Unauthenticated versus unauthorized responses do not reveal private content. Bound input sizes and reject foreign origins. Sessions and invitations can be revoked without changing unrelated credentials.

### Memory contract and policy

Preserve Memory and pensieve/v1 compatibility. Add optional validated metadata for raw versus distilled, supplied citations, synthetic status and ticket references. Team contribution authorship is recorded by the server from the authenticated actor, never trusted from user content. Source project/session/location remain evidence, never paths or instructions to execute. Immutable IDs are idempotent for identical content; conflicting content under one ID fails transactionally.

CapturePolicy = { destination: 'private'|'shared'|'off', pool?: string, autoSave?: boolean }. Override precedence: conversation, repository, team; each supplied policy must be valid. A shared destination requires a pool ID; private/off may not retain a shared destination. Missing all settings yields private, autosave false. A configured team can select shared/autosave true. Reject unknown fields, malformed TOML, invalid destination, ambiguous/missing shared pool. No silent fallback on denied sharing. UI/CLI/MCP use the same resolver. Incoming untrusted memory never sets policy. Policies can be saved outside memory content and inspected as effective settings. Auto-save applies only to supported session/tool inputs, not invisible browser history.

### Team store contract (new src/team-store.ts)

Export TeamUser {id,name}, TeamPool {id,name,visibility:'private'|'shared',role:'owner'|'writer'|'reader'}, TeamMember {userId,name,role}, TeamMemory {memory: Memory, contributorId:string, createdAt:string}.

TeamStore(path): close(); createUser(name):{user:TeamUser,token:string}; authenticate(token):TeamUser; revokeUser(userId):void; createPool(actorId,name,visibility):TeamPool; listPools(actorId):TeamPool[]; getPool(actorId,poolId):TeamPool; grantMember(actorId,poolId,userId,role:'reader'|'writer'):void; listMembers(actorId,poolId):TeamMember[]; putMemory(actorId,poolId,memory):{id:string,created:boolean}; listMemories(actorId,poolId):TeamMemory[]; getMemories(actorId,poolId,ids:string[]):Memory[]; exportBundle(actorId,poolId,ids:string[]):Bundle; index(actorId,poolId,provider:EmbeddingProvider):Promise<number>; search(actorId,poolId,query,provider,limit?):Promise<Hit[]>.

All actor IDs passed internally must originate in authenticate or trusted bootstrap. Methods fail for nonexistent/revoked actors as well as missing memberships. Database constraints and transactions enforce atomic contribution, conflict checks and member updates. Vectors are scoped by pool, model identity and dimensions. Server API never accepts arbitrary caller actor IDs.

### Creator server, browser UI and sharing

New createTeamServer(store, {ownerToken,publicUrl,provider?,shareStore?}) returns Node HTTP server. Root browser UI offers invite sign-in, pool creation/list, pasted memory and supported text/JSON uploads, raw/distilled choice with source/citation fields, effective capture destination, selected-memory editing before save, member grants, semantic index/search, reviewed brief, separate recipient selections and links/downloads. Do not label raw excerpts as distilled. File uploads are content, not server filesystem paths. All rendered untrusted content uses textContent, never injected HTML.

Canonical team API under /api/team: POST /admin/users (operator only) -> {user,token}; GET /me; GET/POST /pools; GET /pools/:id; GET/POST /pools/:id/memories; GET/POST /pools/:id/members; POST /pools/:id/index; POST /pools/:id/search; POST /pools/:id/export with explicit ids; POST /pools/:id/shares with explicit ids, reviewed brief, recipients and expiry. GET /pools/:id/memories returns {memories:TeamMemory[]}; POST accepts {memories:Memory[]} atomically or a single validated record as documented. Credentials never appear in pool bundle/response metadata. Missing provider yields explicit index/search error, not keyword fallback. Sharing integrates existing ShareStore; readers use existing invitation/read/download behavior via delegated routes without access to team management. UI shows ready/saving/pending/failed states accurately.

### Agent and client integration

Provide shared TeamClient with HTTPS-or-loopback base URL and bearer identity. CLI team-server, team-invite, connect, team-pools, save, recall, sync and mcp commands expose the same policy and authorization. Read/parse/persist client credentials with mode0600 and never print them except explicit invitation generation. `save` accepts current-agent supplied distilled text and references; optional provider distillation remains opt-in and unsupported configurations produce explicit errors. Offline sync keeps a local outbox and retries idempotently; pull merges only granted pool context and keeps original provenance. Private/off overrides never enqueue shared writes. A documented explicit watch-session route supports append-only Codex/Claude Code automatic capture, current/historical exact-project metadata selection and bounded configurable polling.

Use the official MCP SDK for stdio integration. Expose only authorized list_pools, save_memory, recall_memories, prepare_share/export tools. Scope is server-side; tools cannot override identity. Implement remote Streamable HTTP plus proper client authentication/OAuth flow if supported within the SDK and validated; do not market bearer-only raw HTTP as a working Claude web connection if client cannot use it. Independent tests use official SDK clients. Live Claude app account handshake is separately marked unverified without an eligible signed-in client. Setup/docs must give exact capability limits. Host/Origin validation and session-to-user binding are required.

### Azure vector backend

New adapter accepts explicit HTTPS Azure AI Search endpoint/index, credential reference and embedding model/dimension configuration. Upsert and search use pool filters applied by trusted server code; retrieval must recheck authorization and allowed memory IDs. No caller-controlled unescaped filter or arbitrary network destination. Validate dimensions and failed item results, reject redirects, use timeouts. No keys in logs/bundles. Azure adapter tests use deterministic HTTP doubles and mark them as contract tests; no live claim without real deployment. Local cosine search remains usable and honestly described as an exact scan.

## Verification and acceptance

Retain failing tests before the new implementation, then passing tests after. Mandatory adversarial cases: user B cannot list/search/export/share/write user A's private pool; reader cannot write/grant; revoked token fails; synthetic/source-instruction text stays data; selected share A excludes B-only memories; malformed config does not publish; private/off does not call network; network retry duplicates do not duplicate memories; conflicting IDs roll back; embeddings/model dimensions isolate; bad/expired connector auth fails; legacy bundles and reader behavior pass existing tests. Browser integration drives creator capture/select/share and recipient download with synthetic credentials. Official SDK integration drives list/save/recall and confirms denied access. Export/unpack roundtrip preserves provenance and excludes secrets. Real local embedding smoke is separate from deterministic fixtures. CI runs typecheck/test/build plus new executable integration suites.

No final delivery claim while required interfaces are stubs. Maintain a requirements-to-evidence table, listing unavailable live Azure/Claude verification separately. Reviewer can block and require repairs. Formal Nightshift status stays BLOCKED; manual review/test results have independent artifacts and identities.

## Files to change / ownership

- Core: new src/team-store.ts, src/policy.ts, src/memory-record.ts; additive src/types.ts + src/store.ts validation; corresponding core tests.
- Creator surface: new src/team-server.ts, optional src/team-auth.ts, web/team.html/js; team-server integration tests; delegate legacy reader without changing its credentials.
- Agent/client: new src/team-client.ts, src/agent-server.ts, src/azure-vectors.ts, associated tests. Root integrates CLI and final cross-surface behavior.
- Integration: src/cli.ts, package.json + lock, Dockerfile as needed for packaged dependencies, skills/pensieve/SKILL.md, integrations/claude/pensieve.md, README + operator docs + integration tests + CI.

## Works cited / Sources

Verified existing code at application commit 92bc676 (present unchanged in baseline 6cc24d4, branch delivery/pensieve-shared-memory):
- `src/types.ts:1-26` (commit: 92bc676) — Memory, Bundle, EmbeddingProvider, Hit existing contracts.
- `src/store.ts:7-17` (commit: 92bc676) — v1 validation and existing source/role/size checks.
- `src/store.ts:20-99` (commit: 92bc676) — Store SQLite layout, transactional idempotency, model-scoped embeddings, exact cosine scan and selected bundles.
- `src/sessions.ts:8-14` (commit: 92bc676) — memoryId and makeMemory; immutable source identity.
- `src/server.ts:28-106` (commit: 92bc676) — local single-token authorization, local file imports, capture, configured sharing, selected export. This is not current multi-user pool isolation.
- `src/share-server.ts:15-115` (commit: 92bc676) — owner-created snapshots, recipient authorization and download boundary.
- `src/executive.ts:10-145` (commit: 92bc676) — share validation, invitation credentials, revisions, explicit reviewed brief, excerpt-first answers.
- `src/embeddings.ts:9-46` (commit: 92bc676) — local Ollama default, optional OpenAI, model-specific prefixes, nonzero finite vectors/cosine.
- `src/pools.ts:6-41` (commit: 92bc676) — local pool registry and private settings persistence; not hosted memberships.
- `src/unpack.ts:6-23` (commit: 92bc676) — private SQLite plus agent-readable portable context, no automatic model requirement.

External authoritative references checked 2026-11-06/07; verify version-specific APIs before implementation:
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp — supported remote connector setup and authorization; not browser-history export access.
- https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x — official SDK v1 compatibility line. npm currently reports @modelcontextprotocol/sdk 1.32.2; v1 security maintenance is separate from v2 API design.
- https://github.com/modelcontextprotocol/typescript-sdk — official SDK transport/auth helpers and v1/v2 status.
- https://learn.microsoft.com/en-us/azure/search/vector-search-overview — Azure AI Search vector fields/query semantics; live resource configuration is not supplied.
- https://support.claude.com/en/articles/9450526-export-your-claude-data — export capabilities and account restrictions; do not promise universal automatic access.

## Adversarial amendments — authoritative over earlier proposed contracts

### A1: Portable provenance (BLOCK-1)

Bundle may add a validated `provenance` array with memoryId, contributorId, contributorName, poolId, createdAt and verification (`source-server` or `unverified-import`). Entries must reference included memory IDs and have bounded string fields. Memory source IDs and text do not change when transported. TeamStore.putMemories(actor,pool,memories,provenance?) inserts the batch atomically and returns {imported:number,ids:string[]}; putMemory is a single-record wrapper. Incoming attribution is retained separately as an unverified historical claim, never as authenticated identity. Export includes the current server's authenticated contributor records plus the retained imported origin records. Cross-machine unpack persists provenance alongside context.jsonl and explains that imported authorship is a claim from the source, not authority in the destination. Credentials are excluded. Replay of the same batch is idempotent; conflicting memory bodies roll back the whole batch.

### A2: Outbox publication policy and identity (BLOCK-2)

Persist each queued contribution's intended server/account identity binding, original pool, repository and conversation context. At flush, re-resolve CURRENT effective policy and confirm the current server/account binding. Private/off or a different pool holds the queued item with a visible reason; no silent retargeting. Current remote membership is rechecked by the server on every request. A deliberate explicit publish action can requeue under a newly chosen authorized destination; changing a default is not that action. The client must not replay a different account's outbox after connect switches accounts. Test offline shared enqueue -> private/off and shared A -> B both make no publication, and wrong identity binding makes no publication.

### A3: Team share ownership (BLOCK-3)

Persist mappings shareId -> poolId, creatorId and selected memory IDs. TeamStore exposes recordShare(actor,pool,shareId,ids), listShares(actor,pool), authorizeShareRevocation(actor,pool,shareId). Only owner/writer may create an external share; readers can export their authorized pool content for their own use but cannot issue new hosted invitations. A writer lists/revokes only shares they created; the pool owner can list/revoke all pool shares. An unrelated actor cannot enumerate/revoke any of these. Only recipient routes/assets are delegated to legacy sharing, never /api/shares management. Existing snapshots remain fixed until expiry or explicit revocation; removing a pool member does not retroactively revoke already-issued recipient snapshots. UI/docs must state that distinction and downloaded copies cannot be remotely recalled.

### A4: Required remote MCP/OAuth contract (BLOCK-4)

Implement /mcp using official SDK 1.32.2 StreamableHTTPServerTransport with stateless per-request server instances, JSON response support, and SDK protocol negotiation (supported baseline 2025-11-25). Each request reauthenticates; there is no transport session ID that can substitute for identity. stdio remains a separate client of the same authorized operations.

Use the SDK OAuth authorization router/provider contracts for /.well-known OAuth authorization-server and protected-resource metadata, dynamic client registration, /authorize, /token, and /revoke. Advertise resource PUBLIC_URL/mcp and one `memories` scope restricted further by current pool memberships. Client redirect URLs must be registered exactly, HTTPS or loopback only, without credentials/fragments; never fetch client-supplied URLs. Bound registration counts and rate-limit OAuth routes. Authorize presents a first-party sign-in/consent page requiring the creator's PERSONAL credential, an expiring single-use request nonce, same-origin POST and a same-site nonce cookie. Display client name safely; never echo credentials. Only approval issues a code. Denial issues no grant.

Authorization codes expire after at most 5 minutes, are one-use, and bind actor, client, exact redirect URI, MCP resource, scope and S256 PKCE challenge. Validate resource/redirect/client and PKCE before consuming the code. Access tokens are random, stored hashed, expire after at most 1 hour and bind the actor/client/resource/scope. No refresh token is issued in this prototype; advertise/accept authorization_code only, with reauthorization after expiry. /revoke invalidates issued tokens for the matching client. Revoking the creator also invalidates all grants through actor liveness checks. Resource/audience mismatch is rejected. All durable OAuth state uses the same private database or a separate private file, never logs/plaintext tokens. Test code replay, wrong verifier/redirect/resource/client, expired/revoked tokens and actor revocation with the official SDK client and HTTP flow. A live Claude account handshake remains separately unverified; implemented remote auth cannot be omitted while declaring AC-09 complete.

### A5: Session and policy behavior (HIGH-5)

Browser POST /api/team/session exchanges a personal creator token for a distinct random hashed session, 12-hour absolute lifetime. GET /api/team/me returns only current identity. POST /api/team/logout revokes that session and expires the cookie. Production cookie is HttpOnly, SameSite=Strict and Secure, Path=/; loopback HTTP omits Secure for local tests. Browser mutations require exact configured Origin; bearer API calls without Origin are permitted, foreign Origin is denied even with a token. Revoking a user invalidates their creator credentials and sessions. Provide a verified internal getUser(id) that rejects revoked users for OAuth binding; never accept actor IDs from request JSON.

Policy exports validateCapturePolicy(value), resolvePolicy({team?,repository?,conversation?}), parsePolicyToml(text). Each override replaces the complete policy object; it does not inherit an old pool. Omitted autoSave is false. Empty/missing all scopes is private with autoSave false. TOML tables [team], [repository], [conversation] map to these objects. Unknown fields/tables fail. CLI reads explicit policy files associated with exact current repository and optional exact conversation; no arbitrary substring matching. Team policy settings are persisted per actor/pool and repository/conversation keys in the team DB via authenticated policy APIs; settings changes require owner/writer and affect subsequent capture/flush. Browser selected pool determines a visible explicit target; saving private creates/uses an authorized private pool, disabled capture stores nothing. Local private capture remains in its local Store. Untrusted memory contents never supply settings. Root must test the same resolver on UI/API, CLI and MCP paths, not just a unit helper.

### A6: Azure vector backend injection (HIGH-6)

TeamStore(path, vectorBackend?) accepts VectorBackend {identity:string; upsert(poolId,model,records:{id,vector}[]):Promise<void>; query(poolId,model,vector,limit):Promise<{id,score}[]>}. Both local and Azure workflows retain authoritative memory/membership data locally. Provider model, vector dimensions and pool scope are validated before index/search. Remote upsert can partially succeed; any failed item means failure, and local indexed markers are not committed until the full batch succeeds. Retry uses stable remote IDs. Query passes a trusted escaped pool+model filter and filters returned IDs through the authorized local pool/model index before returning content. Azure configuration is injected by the team-server entrypoint into TeamStore, not a disconnected helper. Exact local cosine scan is default. Adapter integration tests exercise actual TeamStore index/search through the HTTP double and foreign-ID/partial-failure rejection.

Citation correction: existing src/types.ts source range is 1-20, not 1-26. The source code for the exact SDK contracts is installed under node_modules/@modelcontextprotocol/sdk/dist/esm/server/{streamableHttp.d.ts,auth/provider.d.ts,auth/router.d.ts,auth/clients.d.ts}; dependency is pinned in package.json and pnpm-lock.yaml. These inspected interfaces supplement the official SDK source URLs above.

A1 clarification: every provenance entry also includes sourceServer, a stable opaque server/issuer identity persisted by TeamStore (not a local filesystem path). Preserve multiple contributor records; deduplicate by sourceServer + poolId + memoryId + contributorId + createdAt. Imported records are ALWAYS stored/exported as unverified-import regardless of their incoming verification flag. Only locally authenticated contributions from this server receive source-server. Unpack/republish preserves the sourceServer field and trust distinction.
