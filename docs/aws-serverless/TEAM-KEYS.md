# DynamoDB team schema and migration contract

Single table, string pk/sk. Every read is strongly consistent. No team GSI. Common helper: `src/aws-db.ts`. Version numbers start at1. `active` is boolean, `used` boolean prevents unsafe identity linking. Keys below are literal prefixes followed by existing IDs; never replace IDs during import.

| pk | sk | Fields |
|---|---|---|
| SYSTEM | ISSUER | value: preserved sourceServer |
| USER#id | META | id,name,token:SHA256 legacy token hash,active:boolean,used:boolean,version:number |
| TOKEN#hash | META | actor:userID |
| IDENTITY#hash | META | issuer,subject,actor; hash is SHA256(JSON.stringify([issuer,subject])) |
| POOL#id | META | id,name,visibility,owner:userID,version; transient lease/leaseUntil(ms) |
| POOL#id | MEMBER#actor | actor,role,version |
| USER#actor | POOL#id | poolId |
| POOL#id | MEMORY#id | memory:Memory,revision:SHA256(canonical JSON),contributorId,contributorName,createdAt,batchId,origins:MemoryProvenance[],version |
| BATCH#batchId | META | kind:index-batch,state:committed,poolId,actor,created:epochms,indexState:pending,indexVersion:0 |
| BATCH#batchId | JOB#memoryId | kind:index-job,poolId,memoryId,revision,state:pending |
| POOL#id | SHARE#shareId | shareId,poolId,creatorId,ids:string[] |
| POOL#id | POLICY#actor#scope#hash | policy:CapturePolicy; hash SHA256(context), team scope uses pool owner actor |

Canonical JSON recursively sorts object keys and leaves array order unchanged. Imported memory origins retain source attribution but remain unverified-import. Source locally authored rows retain original contributor IDs/names/timestamps and issuer. Initial import may use one deterministic committed batch per source pool, with all jobs created before publishing its marker. For restart safety, stage marker first and conditionally publish after every record and job validates. Do not mark committed while records are still being loaded. Set used=true for actors owning pools or memberships/business records. Import source team_shares mapping and add poolId/creatorId to matching SHARE#shareId/META.

The public importer must reject conflict before publication. Direct writes bypass domain authorization and are exclusively maintenance migration operations, never API routes. The runtime and indexing worker require every memory batch marker to be committed, including migrated records. Missing markers make records invisible deliberately. S3 vectors can be regenerated; source SQLite vector arrays do not need to be copied to S3 Vectors, but keep them in backups and re-embed with configured provider.

Large imports use a pool lease, bounded staged transactions, then a committed marker. A staged write includes memory and job atomically. Failed/new memory rows stay invisible; a subsequent import may replace abandoned rows. Existing committed memory bodies never change. New origin metadata is staged using originBatch/pendingOrigins; export only uses that provenance after the matching batch commits. Failed staging does not destroy the previous committed provenance.

API pages bound examined rows, not only returned rows: a page can be empty with nextCursor while unpublished rows exist. Callers must follow cursor. Worker processIndexBatch processes16 records default/max32 and updates the batch marker with cursor/indexVersion; its stream MODIFY creates continuation. Explicit index queues a reindex batch that traverses bounded MEMORY# pages rather than embedding in the HTTP request.

Records over300KB are rejected before staging writes, preserving margin under DynamoDB400KB. No TTL on authoritative rows/batch markers; expired leases are evaluated by application time, not asynchronous TTL deletion. Cleanup/reconciliation may remove abandoned staging only after verifying it is neither committed nor actively leased.

Index receipts: POOL#id / INDEX#SHA256(model)#memoryId contains revision/model. Workers skip matching receipts before paid embedding, and commit receipts with the work cursor only after vector persistence succeeds and authorization/revision checks pass. INDEX-RUN#SHA256(model) contains batchId/created and deduplicates active explicit reindex runs. Completed explicit requests have a60-second cooldown; a pending run can be re-signaled after15minutes without replacing its cursor. Failure between a paid embedding call and receipt commit can still repeat that call: no exactly-once guarantee is made. Stream/dead-letter reconciliation must preserve and expose pending work.

Recovery registry: every staged or explicit batch also creates WORK#INDEX / PENDING#batchId with batchId in its creation transaction. Ready indexing atomically removes that registry entry. Migration must create registry entries before publishing imported batches. `reconcileIndexWork(provider,{limit:5})` rotates through registry pages using SYSTEM/INDEX-RECONCILE cursor, advances at most16 records per committed batch, and cleans only failed or expired staging. `cleanupAbandonedBatch(batchId)` never deletes a committed batch, checks expired pool lease before failing staging, and conditionally deletes only memory rows whose batchId still matches the failed batch. Existing committed rows with newer/different batch IDs and shared provenance bodies are preserved. The hourly invoker is owned by runtime/Terraform integration. No table Scan is used.
