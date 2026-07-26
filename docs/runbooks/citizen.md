# Runbook: citizen-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, grievance/RTI SLA compliance ≥ 95%.

- **Purpose:** public-facing citizen portal — grievance registration/tracking (CPGRAMS-style), RTI filing/appeals (RTI Act 2005), service applications with eligibility checks, fee payments (BBPS), certificate issuance, and SLA-driven auto-escalation. Owns `civitas_citizen`. PII-heavy (Aadhaar, phone, email encrypted via `encryptedText()`).

- **Owner / escalation:** primary: Citizen Domain Owner. Secondary: SRE. Page on any SLA-sweep failure (missed statutory deadlines carry legal liability under RTI Act) or payment-path DLQ entries.

- **Dependencies:**
  - Own Postgres DB (`civitas_citizen`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for application status, grievance lists, catalogue lookups.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for profile, application, grievance, RTI, ticket, payment lifecycle; events for SLA breaches, approvals, certificate issuance.
  - PII columns encrypted at rest (Aadhaar, phone, email, address) via `@civitasone/pii-crypto`.
  - Cross-service: workflow-service (approval orchestration), notification-service (citizen SMS/email), finance-service (fee receipts), identity-service (DigiLocker verification).
  - SLA sweep scheduler: periodic `citizen.*.sla_check` commands trigger auto-escalation on breach.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ depth, consumer error rate, outbox relay health).
  - Grafana: grievance resolution time distribution, RTI response SLA compliance (30-day statutory limit), application processing p95, SLA breach count by category.
  - Alert: SLA breach rate > 5% = WARN, > 15% = CRITICAL (statutory non-compliance territory).

- **Common failure modes → action:**
  - *SLA sweep not firing* (grievances/RTI aging without escalation) → verify the scheduled job is running (`citizen.grievance.sla_check`, `citizen.rti.sla_check` topics); check if the scheduler (admin-service scheduled-jobs or cron) is active; manually publish an SLA check command to drain the backlog.
  - *DLQ filling on `citizen.grievance.*`* → inspect message payload; common causes: (1) assignee lookup failure (officer transferred — update assignment), (2) notification-service down (non-blocking, but logs ERROR — check notification health).
  - *Payment callback failing (`citizen.payment.requested`)* → verify BBPS/Razorpay webhook endpoint is reachable; check circuit-breaker state; payments are idempotent (safe to redrive after fixing connectivity).
  - *Certificate issuance stuck* → verify the downstream workflow-instance for the application exists and is not in `rejected` state; check if the DSC signing service (render package) is healthy.
  - *RTI transfer failing* → verify target department tenant exists; transfers require both source and target tenant context — RLS may reject if tenant mismatch in payload.
  - *High read latency on application lists* → check Redis hit ratio; catalogue/eligibility lookups are cached aggressively (5-min TTL) — if cache miss rate > 40%, investigate eviction pressure or missing cache keys.
  - *PII decryption errors* → `ENCRYPTION_KEY` env var mismatch between instances; all replicas must share the same key. Never rotate without re-encrypting existing data first.

- **Rollback:** redeploy previous image tag. Migrations are forward-only. If a schema change affects application status workflows, coordinate with workflow-service (in-flight instances may reference old states).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify SLA timers are recalculated (some `dueAt` fields are computed at creation time — they survive restore). Confirm no duplicate certificates were issued by checking issuance idempotency keys. Statutory RTI timelines are absolute (30 days from filing) — a restore does not reset them.
