# Independent manual adversarial specification review

Status: **CHANGES REQUIRED — implementation contracts blocked pending corrections below.**

Reviewer: manual_spec_review, independent of the controller/spec author. Reviewed the initial manual SPEC (81 lines), BUILD-BRIEF and DECISIONS against actual application source. This is a manual review, not a Nightshift gate, retry, or approval. No application code was changed. Findings concern proposed contracts, not claims that unimplemented code is already vulnerable.

## BLOCK-1 — Export drops authenticated contribution provenance

Evidence: SPEC.md:21 promises authenticated authorship; :27 stores contributorId/createdAt outside Memory in TeamMemory; :29 exports Bundle and returns Memory[]; :41 promises original provenance on pull. Existing src/types.ts:1-19 contains no contributor or origin identity, and Bundle carries only Memory[]. src/unpack.ts:16-18 imports and serializes those memories. BUILD-BRIEF.md:31,35-36 requires authorship, intact provenance and who contributed what.

Consequence: exporting an authenticated contribution and importing on another machine loses the authenticated contributor, or the receiving user's identity overwrites attribution. Source='claude' is a tool name, not an author. Arbitrary incoming provenance must also not become locally authenticated identity.

Correction: define an additive portable provenance schema before implementation. Distinguish original claimed source/author, authenticated server contribution (including issuer/server identity), and current importing contributor. Preserve original provenance through export/download/unpack/pull, but mark externally supplied claims unverified unless independently verified. Define whether attribution travels in an optional Memory extension or compatible bundle envelope and validate it on every boundary. Define IDs without allowing enrichment to create conflicting immutable records. Required proof: creator A -> curated export -> machine B unpack -> B contribution preserves A's origin without impersonating A at B's server; forged contributor metadata cannot select authenticated actor.

## BLOCK-2 — Policy changes can leave queued shared publication authorized by stale policy

Evidence: SPEC.md:23 defines overrides and :41 says private/off never enqueue shared writes; neither defines dispatch-time handling for an already persisted outbox. BUILD-BRIEF.md:34 explicitly requires changes to policy to affect subsequent publication, and :33 prohibits private/excluded publication.

Counterexample: shared capture queues offline; user changes conversation to private/off; reconnecting flushes the old shared job. Enqueue-time validation alone satisfies the current wording while violating the parent requirement.

Correction: persist queue destination, identity/server binding and policy context/version; resolve current policy and check current membership immediately before network publication. A private/off or changed destination holds the old job visibly; never automatically retarget it to a different pool. Define whether a deliberate publish action can release a held job. Scope local configuration to server/account/repository/conversation so switching accounts does not replay another account's outbox. Required proof: shared enqueue -> private/off -> reconnect produces no publication; shared pool A -> B change does not silently move queued A data; revoked access cannot flush.

## BLOCK-3 — Team share ownership and revocation lack a safe contract

Evidence: SPEC.md:17 promises revocable invitations and no reader mutation; :37 only defines share creation and delegates reader routes. Existing src/executive.ts:8-9,35-37 stores no creator/pool ownership; :52-55 lists all shares; :72 revokes by ID without actor. Existing src/share-server.ts:43-65 protects management with the one global owner credential. BUILD-BRIEF.md:32,39-40 requires isolation and preserved sharing without distributing that key.

Consequence: a creator has no specified way to retract their share, while delegating legacy management would expose global administrative operations or require distributing the operator key. Also unspecified: whether readers may export/share externally, and whether writers can revoke other writers' shares.

Correction: define a server-owned mapping share ID -> creator ID, origin pool ID, selected IDs; define explicit create/list/revoke role rules and authenticated team management routes. Delegate only recipient routes/assets to legacy hosting. Keep global-owner management inaccessible to creator credentials. State whether removal from a pool invalidates existing snapshots or whether only explicit share revocation does; either policy must be visible. Test creator B cannot enumerate/revoke creator A's shares, reader role restrictions, share revocation rejects previously issued reader tokens, and legacy management cannot be reached via team delegation.

## BLOCK-4 — Required remote Claude connection is made optional without an implementable auth contract

Evidence: BUILD-BRIEF.md:22,38 and DECISIONS.md:5,8 require the conversational-app connection path. SPEC.md:43 instead says implement remote HTTP/auth “if supported within the SDK and validated,” and only names generic OAuth. No protocol version, HTTP route, authorization server/resource metadata, client registration policy, consent/account binding, redirect handling, code exchange, access expiry/revocation, or session authentication contract is provided.

Correction: commit to a supported versioned remote MCP transport/auth design with exact official-source citations and define those boundaries, including PKCE and exact registered redirect handling where required by that chosen flow. Reauthenticate every transport request and bind transport sessions to the authenticated user. Do not confuse a transport session ID with authorization. If remote auth cannot be built in this delivery, mark AC-09 incomplete explicitly rather than letting the conditional silently remove it. A live Claude account handshake may remain separately unverified as the parent permits; the implemented server/auth flow and official-client integration may not be omitted or represented by stdio-only proof. Include cross-user session replay, expired/revoked credentials, bad resource/audience and invalid authorization exchange tests appropriate to the selected protocol.

## HIGH-5 — Browser/session and policy persistence contracts are insufficiently coordinated

Evidence: SPEC.md:17 promises browser token exchange and independent revocation, but :29 only supplies revokeUser; :37 has no login/logout/session-revoke or policy settings API. :23 does not define whole-policy replacement versus field merging, scope identifiers or storage authority. Thus independent UI/CLI/MCP implementations can disagree about autosave inheritance, or expose UI settings which never affect server capture.

Correction: specify login/logout/session lifetimes and revocation relationship to user/credential revocation; HttpOnly/Secure production cookies, allowed same-origin mutation behavior and failure responses. Specify validated policy storage/read/write interfaces, exact matching of repository and conversation scope, whole-policy versus field inheritance, and how every surface obtains the same effective policy. Include how personal private destination maps to a local or hosted private store for each surface. Controller message proposing validateCapturePolicy/resolvePolicy/parsePolicyToml and top-level kind/citations/synthetic/ticket narrows schema ambiguity but does not yet settle these persistence/override contracts. Its proposed atomic putMemories method addresses the initial single-put/batch transaction mismatch; incorporate it in SPEC and tests before relying on it.

## HIGH-6 — Azure adapter has no integration seam into actual index/search

Evidence: SPEC.md:47 defines an adapter but :29 index/search accept only EmbeddingProvider and :35 server options expose provider only. Existing src/types.ts:11-14 defines EmbeddingProvider as embedding generation, not vector persistence/query. BUILD-BRIEF.md:37 requires a configurable vector backend, not merely an independently tested HTTP helper.

Correction: specify the vector-backend interface, selection/configuration and injection into the same authorized index/search workflow used by UI/CLI/MCP. Define model+dimension+pool namespace and allowed-ID postfilter semantics, including no cross-pool result exposure. An HTTP double integration test must prove selecting Azure causes real team index/search to use the adapter and fails closed on foreign-pool IDs, mismatched dimensions and partial upsert failures. Local exact cosine behavior and unavailable live Azure evidence remain separate.

## Source-claim verification

The cited core identifiers exist: Memory, Bundle, Hit and EmbeddingProvider (src/types.ts:1-20); validateBundle and Store (src/store.ts); memoryId/makeMemory (src/sessions.ts); createShareServer and recipient/owner route separation (src/share-server.ts); ShareStore and validateShare (src/executive.ts); unpack (src/unpack.ts:6-23). The cited source behavior supports the legacy baseline, not new team ACL, remote MCP or Azure functionality. New names are correctly labeled proposed in SPEC.md:13. Minor citation correction: src/types.ts ends at line 20, so its :1-26 range overshoots. External URL/version claims were not independently re-fetched by this reviewer; controller must retain its dated source-check receipts and verify exact APIs during implementation. No external claims are independently certified here.

## Release of this review block

Controller should amend SPEC with the concrete decisions and reply with finding-to-section mapping. Re-review the changed contracts before implementation of dependent security/routing surfaces. Retain this original finding record and append dispositions rather than replacing it with an unexplained PASS. Tests/build/runtime evidence and later code/security review are still required; this document cannot certify them.

## Amendment re-review — A1 through A6

Independent reviewer re-read SPEC.md:83-115 and verified the installed SDK declarations. **A2–A6 release their implementation design blocks. A1 is acceptable subject to the small explicit issuer/verification clarification below.** This is permission to implement the revised design, not evidence that it works, not final acceptance, and not a Nightshift pass.

| Finding | Disposition | Evidence / remaining proof |
| --- | --- | --- |
| BLOCK-1 | Substantially corrected; issuer clarification required | A1 adds portable Bundle.provenance and unverified imported claims, atomic batch ingestion and separate unpack persistence. Add sourceServer/issuer to each record, deduplicate by origin/memory/contributor, and explicitly downgrade all incoming verification flags to unverified-import. Otherwise two deployments' contributor IDs cannot be distinguished. Verify export/import/re-export retains origin and never impersonates a destination actor. |
| BLOCK-2 | Design block released | A2 re-evaluates current policy and server/account binding at flush, holds changed destinations and rechecks current membership. Implement and test old-queue private/off, account switch and pool switch cases. |
| BLOCK-3 | Design block released | A3 adds durable creator/pool/selection mapping, writer-own versus owner-all revocation, and limits delegation to reader routes. Membership removal versus existing snapshot behavior is explicit. Tests must exercise the real HTTP management routes and previous reader credentials after revocation. |
| BLOCK-4 | Design block released | A4 makes remote implementation mandatory, chooses stateless SDK HTTP, and defines bound single-use authorization codes, PKCE, resource/client checks, consent, hashed expiring tokens and revocation. Actual OAuth/SDK interoperability remains mandatory; live Claude account evidence remains a separately reported limitation. |
| HIGH-5 | Design block released | A5 defines distinct sessions, expiry/logout, actor revocation, exact Origin behavior, whole-object policy replacement, omitted autosave false, matching and persistence. API/UI/CLI/MCP resolver integration must be demonstrated. |
| HIGH-6 | Design block released | A6 injects VectorBackend into TeamStore and defines partial failure, stable retries and authorized local result filtering. Test actual TeamStore through the adapter, not just helper methods. |

Local SDK evidence: node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts:58 declares StreamableHTTPServerTransport; server/auth/provider.d.ts:15 declares OAuthServerProvider; server/auth/router.d.ts:39,64 declares resourceServerUrl and mcpAuthRouter; types.js:2 declares latest protocol version 2025-11-25. This verifies identifiers and the version constant, not correctness of a future integration.

Original findings above are retained unchanged. Implementation must still undergo independent review, adversarial tests, typecheck/build, and cross-surface runtime proof. External live Azure and Claude verification must remain visibly unverified until actually performed.

### Final specification disposition

Re-read SPEC.md:117. The controller added stable sourceServer/issuer identity, a composite deduplication key preserving multiple contributors, unconditional downgrade of imported verification claims, and preserved source/trust distinctions through unpack/republish. **BLOCK-1 design block is released. All six original specification findings now have sufficient contract corrections to begin implementation.** This supersedes the pending A1 condition in the table, while retaining the historical record. No runtime, code-security, final acceptance, deployment or Nightshift gate is certified by this disposition.
