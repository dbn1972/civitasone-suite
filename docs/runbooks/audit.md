# Runbook: audit-service

> Tier 1 (write-mostly). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, no read-latency SLI (write-mostly), event ingest lag < 30s (see §3).

- **Purpose:** platform-wide audit event ingestion/recording, audit plan/observation/para (finding) lifecycle, risk register, pending-recovery tracking, vigilance, compliance exports. Every mutation across all 33 services emits an Audit_Event to this service via outbox — it is the CERT-In Directions 2022 structured-audit-log backbone. Owns `civitas_audit`.

- **Owner / escalation:** primary: Audit domain owner. Secondary: Security. Page immediately on any event-ingest lag exceeding 30s sustained, or any hash-chain verification failure — both are compliance-reportable conditions, not routine operational issues.

- **Dependencies:**
  - Own Postgres DB (`civitas_audit`), RLS enabled.
  - Redis — read-through cache for dashboard/compliance queries.
  - SQS/RabbitMQ topics: consumes `audit.event.ingest`/`audit.event.record` (the universal sink every other service's outbox relay publishes to on every mutation); owns commands for plan/observation/risk/para lifecycle (`audit.plan.create/start`, `audit.observation.create/reply/review/close`, `audit.risk.create/update/link_plan`, `audit.para.draft/issue/dept_response/settle/pending_recovery/close`, `audit.pending_register.create`, `audit.export.create`); events `audit.export.requested`, `audit.para.issued/pending_recovery`.
  - Consumed cross-service: `finance.payment.made`-adjacent flows via `audit.para.pending_recovery` feeding back into finance-service's recovery tracking.
  - **Tamper-evident hash chain on every audit event** (`modules/events/domain.ts`) — each event's SHA-256 digest binds `id:tenantId:type:prevHash:occurredAt:contentDigest` (where `contentDigest` folds actor/target/payload into a canonical-JSON SHA-256), forming a per-tenant chain where altering any row's content breaks every subsequent link. This is the CERT-In tamper-evidence requirement applied to the audit log itself (distinct from estab-service's noting hash chain, which protects file notings).
  - Log retention ≥ 180 days per CERT-In Directions compliance mapping.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Grafana: event-ingest lag (30s target), DLQ depth on `audit.event.ingest` (a stuck ingest queue means every other service's audit trail is silently falling behind), para/observation closure rates.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `audit-worker`) → restart worker immediately; a stalled audit-event consumer means every mutating write platform-wide is still succeeding but its audit trail is accumulating in outbox tables fleet-wide — treat as urgent even though it's not user-facing.
  - *DLQ filling on `audit.event.ingest`* → read DLQ `error`; this queue receives events from all 33 services, so a poison-message pattern here likely indicates a schema/contract drift in one publisher's event payload rather than an audit-service bug — identify the source service from the DLQ payload before redriving.
  - *Hash chain verification failure* → treat as a P0 security/compliance incident; do not attempt automated repair. A broken link on the audit log itself is the most severe form of tamper-evidence failure on the platform and may trigger CERT-In's 6-hour incident reporting mandate if it indicates unauthorized modification.
  - *Outbox relay failing (upstream services)* → this shows up as ingest lag on audit-service even though the root cause is elsewhere; check the reporting service's own outbox relay health, not audit-service's consumer, first.
  - *Para/observation SLA overdue* → check the dept-response/settle workflow state machine, not infra; this is a compliance-process signal.
  - *Compliance export failures (`audit.export.requested`)* → check `@civitasone/render`/`@civitasone/storage` reachability for the export-generation pipeline.

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema. Never edit an audit event row directly, even to "fix" a data-entry mistake — the immutability of this table is the entire point; corrections must be new compensating events, never in-place edits.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity by re-running hash-chain verification across every tenant's event chain since the last known-good backup before returning to service — an audit-service restore is incomplete until the chain is proven intact end-to-end.
