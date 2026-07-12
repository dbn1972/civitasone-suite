# Runbook: estab-service

> Tier 1 (eOffice). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 500 ms, command commit < 5s (see §3).

- **Purpose:** government file/noting lifecycle (DAK receive → File create → Note → Approve → Dispatch), committee/meeting management, RTI, records retention/weed-out, and facilities (vehicle/guesthouse/library booking). Owns `civitas_estab`. First service to adopt the `createTenantDb`/`TenantRouter` pattern (the template for the fleet-wide rollout in this hardening effort).

- **Owner / escalation:** primary: Estab domain owner. Secondary: SRE. Page on any noting-hash-chain integrity failure — this is CERT-In-relevant tamper-evidence, not just an availability concern.

- **Dependencies:**
  - Own Postgres DB (`civitas_estab`), RLS enabled — already routed through `createTenantDb`/`TenantRouter` (pool/silo/shard).
  - Redis — read-through cache for file/dashboard queries.
  - SQS/RabbitMQ topics (`src/topics.ts`): file lifecycle (`estab.file.create/move/close/recall/reopen`), noting (`estab.noting.add/submit/sign`), dispatch/inward, committee/meeting/resolution, RTI (`estab.rti.create/respond`), records/weed-out; events `estab.file.created/moved`, `estab.rti.created/responded/overdue`, `estab.resolution.created`.
  - **eOffice SDK** (`@civitasone/eoffice-sdk`) — `MODULE_CALLBACK_TOPICS`, the single source of truth for decision-callback routing back to source modules (finance, HRMS, etc.) when a raised eFile is approved/rejected.
  - Consumed cross-service events: `citizen.rti.filed` (citizen-service), plus generic `estab.file.approve`/`estab.file.reject` callbacks from any module that raised a file.
  - **Tamper-evident noting hash chain** (`modules/files/domain.ts`, `computeNotingHash`) — each green note's SHA-256 hash binds `notingId:body:officerId:prevHash:signedAtMs`, forming a per-file chain (SO → US → DS) that cannot be silently rewritten without breaking every subsequent link (CERT-In Directions 2022 compliance).
  - DSC signing via `@civitasone/render` (PKCS#7) for noting signatures.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Grafana: p95 read latency (500ms target), command-commit latency (5s target), RTI SLA-sweep on-time rate, weed-out job completion.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `estab-worker`) → restart worker; inspect last message on the noting/file command topics; check DB connectivity.
  - *DLQ filling on `estab.noting.*`* → read DLQ `error`; poison (validation, e.g. malformed body) → fix upstream; transient → redrive after dependency recovers. Never redrive a noting-sign message without first confirming the prior chain link (`prev_hash`/`chain_seq`) wasn't already advanced by a partial retry, to avoid a broken chain.
  - *Noting hash chain verification failure* → treat as a P0/security incident, not a routine DLQ issue; a broken link means either concurrent-write corruption or tampering — escalate to Security immediately, do not attempt an automated repair.
  - *Outbox relay failing* → check DB + SQS reachability; relay is idempotent, safe to resume.
  - *p95 read latency high* → check Redis hit rate on file/dashboard queries, DB slow queries (large file/noting history joins).
  - *RTI SLA sweep overdue* → check the scheduled sweep job's worker heartbeat; overdue RTIs are a statutory-compliance risk, escalate faster than the default DLQ threshold.
  - *eOffice callback not delivered to source module* → verify `MODULE_CALLBACK_TOPICS` mapping in `@civitasone/eoffice-sdk` matches the raising module's `source_ref_type`; check outbox relay lag on the decision event.

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema. Never attempt to "fix" a noting hash-chain row directly in the DB; a schema-level rollback of noting/file tables requires restore-from-backup plus chain re-verification.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity AND re-verify the noting hash chain end-to-end for every file touched since the last known-good backup before returning to service.
