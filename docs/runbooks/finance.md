# Runbook: finance-service

> Tier 1. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 400 ms, command commit < 5s, DLQ = 0 (see §3).

- **Purpose:** double-entry GL, budget/sanction/bill/payment lifecycle (Sanction → Bill → 3-way match → Payment → PFMS), treasury (challans/deposits), GST/TDS, and government-payment-rail integration (PFMS/e-Kuber, TRACES). Owns `civitas_finance`.

- **Owner / escalation:** primary: Finance domain owner. Secondary: SRE. Page on any payment-path (`finance.payment.*`) DLQ entry — financial writes have a double-spend guard and are never safe to silently drop.

- **Dependencies:**
  - Own Postgres DB (`civitas_finance`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for budget/GL/dashboard queries.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands across budget, GL (`finance.gl.post/reverse`), treasury, payments (`finance.bill.create/approve`, `finance.payment.initiate`); events `finance.sanction.approved`, `finance.bill.passed/mismatch`, `finance.payment.made`, `finance.gl.posted/rejected`, `finance.transaction.posted` (consumed by ml-service for anomaly detection).
  - Consumed cross-service events: `audit.para.pending_recovery` (audit-service), `payroll.run.approved/finalized` (payroll-service), `procurement.grn.accepted` (procurement-service), `grant.uc.submitted` (grant-service), `ml.prediction.anomaly_detected` (ml-service, Z-score > 3), plus eOffice file-decision callbacks (`finance.sanction.file_decided`, `finance.payment.file_decided`, `finance.reappropriation.file_decided`).
  - **PFMS/e-Kuber adapter** (`modules/pfms/adapter.ts`) — env-gated (`PFMS_ENABLED`), fails closed when disabled; every outbound call wrapped in `@civitasone/circuit-breaker` (5 consecutive failures → open 30s). No PII logged, only entity/correlation IDs and status codes.
  - **TRACES adapter** (`modules/traces/adapter.ts`) — same circuit-breaker pattern for TDS certificate reconciliation.
  - All monetary columns are `bigint` paise (never `float`/`number` for computation) — see the platform-wide bigint-precision invariant.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Gateway `/ready` — finance is one of the three gateway-health-checked upstreams (identity, finance, queue).
  - Grafana: p95 read latency (400ms target), command-commit latency (5s target), PFMS/TRACES circuit-breaker open/half-open state, GL posting rate, anomaly-detection consumption lag.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `finance-worker`) → restart worker; inspect last message on the payment/GL command topics; check DB connectivity before anything else, since payment commands carry a double-spend idempotency check.
  - *DLQ filling on `finance.payment.*`* → read DLQ `error`; poison (validation) → fix upstream producer; transient (PFMS/DB blip) → redrive only after confirming the PFMS circuit breaker is closed and the target payment wasn't already accepted upstream (check `PfmsPaymentResult.status` before redriving to avoid a duplicate disbursement).
  - *PFMS/TRACES circuit breaker open* → check the government rail's own status; the breaker auto-attempts half-open after 30s. Do not manually force-close; let backoff run its course while queued payment commands accumulate safely (idempotency key prevents double-submission on retry).
  - *Outbox relay failing* → check DB + SQS reachability; relay is idempotent, safe to resume.
  - *p95 read latency high* → check Redis hit rate on budget/GL dashboards first, then DB slow queries (financial-statements/dashboard modules do heavier aggregation).
  - *GL mismatch (`finance.bill.mismatch`)* → this is expected business-flow output (3-way match failure), not an incident — verify it's routed to the correct approval/return workflow, not silently dropped.

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema (GL/ledger schema changes especially require restore-from-backup rather than a destructive rollback).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity — every GL posting and payment must reconcile against the audit-service event log post-restore. Given financial double-entry integrity requirements, a restore must be followed by a trial-balance check (`financial-statements` module) before returning to service.
