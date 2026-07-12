# Runbook: payroll-service

> Tier 1. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 500 ms, payroll run within SLA window (see §3).

- **Purpose:** payroll structure/component configuration, monthly run compute/approve/disburse, loans, tax declarations (old/new regime), NACH bank-file return processing, full-and-final (F&F) settlement, Form-16 bulk generation, and pensioner monthly computation. Owns `civitas_payroll` (184 tests, Tier 1 "production-ready").

- **Owner / escalation:** primary: HR/Payroll domain owner. Secondary: Finance owner (payment-path overlap). Page immediately on any disbursement-path DLQ entry or a payroll run stuck mid-disburse — this is a citizen/employee-facing SLA (payroll run must complete within its SLA window per §3) and a financial-integrity concern simultaneously.

- **Dependencies:**
  - Own Postgres DB (`civitas_payroll`), RLS enabled.
  - Redis — read-through cache for run/slip/dashboard queries.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands `payroll.structure.create`, `payroll.run.create/approve/disburse/revert`, `payroll.loan.create/disburse`, `payroll.tax_declaration.*`, `payroll.nach_return.process`, `payroll.fnf.compute`, `payroll.form16.bulk_generate`; events `payroll.run.approved/disbursed`, `payroll.loan.disbursed`, `payroll.nach_return.processed`, `payroll.fnf.computed/draft_created`, `payroll.form16.bulk_completed`, `payroll.dsc.expiry_warning`.
  - Consumed cross-service events: `hrms.leave.approved`, `hrms.attendance.marked`, `hrms.employee.created/separated` (drives run eligibility and F&F triggers), `finance.payment.made` (disbursement confirmation), `hrms.claim.approved` (LTC claim reimbursement inputs).
  - **NACH/APBS adapter** (`modules/nach/adapter.ts`) — government-rail bank-file mandate/bulk-payment integration; env-gated (`NACH_ENABLED`), fails closed when disabled; wrapped in `@civitasone/circuit-breaker` (5 failures/60s → open 30s). No PII logged, only correlation IDs and status codes.
  - **DSC config loader** (`modules/dsc-config/loader.ts`) — reads DSC certificates from S3/MinIO (`@civitasone/storage`), validated via `@civitasone/render`, wrapped in `@civitasone/circuit-breaker`; used to sign Form-16 and payslip PDFs.
  - **Bigint paise money handling** — every monetary column (`total_gross_minor`, `total_net_minor`, `basic_minor`, `gross_minor`, `net_pay_minor`, PF/GPF/NPS/ESI/TDS `*_minor` columns, pensioner `basic_pension_minor`/`commuted_pension_minor`) is `bigint` in `mode: "bigint"`, never `float`/`number`. Arithmetic must stay in `BigInt()` throughout the run-compute pipeline (`modules/payroll/domain.ts`) to avoid precision loss above 2^53 — this is the platform's highest-stakes bigint-precision surface given run-wide aggregate totals.
  - Pensioner PII (`bankAccountNo`, `bankIfsc`, `pan`) uses `encryptedText()` (shared HRMS-style AES-256-GCM envelope pattern).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Grafana: p95 read latency (500ms target), payroll-run completion time vs. SLA window, NACH return processing success rate, DSC expiry warning lead time.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `payroll-worker`) → restart worker; inspect last message on the run-compute/disburse command topics; check DB connectivity. A stalled worker mid-run risks blowing the payroll-run SLA window — escalate faster than the default Tier-1 threshold.
  - *DLQ filling on `payroll.run.disburse`* → read DLQ `error`; before redriving, confirm the run wasn't already partially disbursed (idempotency key check) to avoid a double-disbursement — this is a double-spend-guard-critical path.
  - *NACH circuit breaker open* → check the bank rail's own status; do not force-close. Queued disbursement commands are safe to sit until the breaker closes, given the idempotency key on each disbursement.
  - *DSC signing failure on Form-16/payslip generation* → check `dsc.expiry_warning` events first (an expired certificate is the most common cause); rotate the DSC via the sponsor-config/dsc-config module before retrying bulk generation.
  - *Outbox relay failing* → check DB + SQS reachability; relay is idempotent, safe to resume.
  - *p95 read latency high* → check Redis hit rate on run/slip dashboard queries, DB slow queries on large-department run aggregation.
  - *Bigint overflow / precision-loss symptoms* (mismatched gross/net totals) → treat as a P0 correctness bug, not an infra issue; verify no code path casts a `*_minor` bigint to `number` for computation (violates the platform's bigint-precision invariant).

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema. Never attempt to manually "correct" a disbursed run's totals via direct DB update — reverse via `payroll.run.revert` command semantics so the audit trail stays intact.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity; re-verify run totals (gross/net/PF/GPF/NPS/ESI/TDS) reconcile against the payslip-level sums for every run touched since the last backup before resuming disbursement.
