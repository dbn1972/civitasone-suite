# Runbook: grant-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, disbursement integrity (no double-disbursement, no release without UC gate clearance).

- **Purpose:** government grant/subsidy management — scheme definition with eligibility criteria, application processing (scoring + approval/rejection), beneficiary management (bank account linkage, Aadhaar seeding), installment-based disbursement (with maker-checker and UC gate enforcement), PFMS reconciliation, utilisation certificate submission/validation, and compliance reporting. Owns `civitas_grant`. Handles government money disbursement to beneficiaries — financial integrity is paramount.

- **Owner / escalation:** primary: Grant/Subsidy Domain Owner. Secondary: SRE + Finance Domain Owner. Page on disbursement DLQ (money flow at stake) or UC gate bypass attempts.

- **Dependencies:**
  - Own Postgres DB (`civitas_grant`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for scheme details, beneficiary status, application pipeline.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for scheme create, eligibility, application submit/score/approve/reject, installment create, disbursement initiate/submit-approval, PFMS reconcile, UC submit, compliance report, beneficiary create/link-bank/seed-aadhaar; events for scheme created, application approved/rejected, disbursement completed/failed, UC submitted/validated/rejected, budget-exceeded alerts.
  - Cross-service consumed: `finance.payment.made` (confirms actual payment execution), `project.milestone.completed` (UC gate — milestone must be complete before next installment), `grant.disbursement.file_decided` / `grant.scheme.file_decided` (estab-service eOffice decision callbacks).
  - Cross-service produces: `grant.uc.submitted` (consumed by finance-service for reconciliation), `grant.disbursement.completed` (consumed by analytics for scheme utilization dashboards).
  - Financial integrity: disbursement amounts validated against approved application amounts; UC expenditure validated against total disbursed; scheme budget ceiling enforced. All amounts in BigInt paise.
  - PFMS integration (env-gated, circuit-breaker wrapped) for Direct Benefit Transfer (DBT) verification.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: scheme utilization rate, disbursement pipeline (pending/in-progress/completed/failed), UC compliance rate, beneficiary coverage, PFMS reconciliation success rate, application approval rate.
  - Alert: disbursement DLQ > 0 = CRITICAL (money stuck); UC gate blocked > 30 days = WARN; PFMS reconciliation mismatch = WARN; scheme budget exceeded = CRITICAL.

- **Common failure modes → action:**
  - *Disbursement stuck (UC gate blocked)* → the UC gate requires the previous installment's utilisation certificate to be validated before the next installment can be released. Check if a UC was submitted (`grant.uc.submit`). If submitted but not validated, check the UC validation consumer. If the UC was rejected, the beneficiary must re-submit.
  - *DLQ on `grant.disbursement.initiate`* → inspect the payload: common causes are (1) beneficiary bank account not linked (required for DBT), (2) Aadhaar not seeded (required for some schemes), (3) amount exceeds scheme budget ceiling. Fix the data issue; never redrive a disbursement without confirming no prior successful disbursement for the same installment (double-spend guard).
  - *PFMS reconciliation failing* → PFMS is an external government system. Circuit breaker will handle transient failures. If persistently failing, check `PFMS_ENABLED` flag and API credentials. Reconciliation can be batched — accumulated transactions will process when connectivity returns.
  - *Application scoring inconsistent* → scoring is rule-based per scheme eligibility criteria. If scores don't match expected values, check the eligibility rules configured for the scheme. Scoring is deterministic — same input always produces same score.
  - *Beneficiary Aadhaar seeding failing* → Aadhaar verification requires the UIDAI/DigiLocker integration (via identity-service). If the external service is down, seeding fails gracefully (beneficiary is created without Aadhaar verification — can be seeded later).
  - *Scheme budget exceeded alert firing* → this means total approved applications exceed the scheme's allocated budget. New applications should be auto-rejected or waitlisted. Verify the budget ceiling was set correctly; if additional funds were allocated, update the scheme budget.
  - *eOffice decision callback not arriving* → disbursement/scheme approval routes through estab-service eOffice. If the callback (`grant.disbursement.file_decided`) isn't arriving, check estab-service outbox relay. The grant stays in `pending_approval` state until the callback arrives — this is safe (no money moves without approval).

- **Rollback:** redeploy previous image tag. Disbursement records are append-only and idempotent (each installment has a unique key). Never delete disbursement records — issue reversal entries if money needs to be reclaimed.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) reconcile disbursement totals against PFMS records — any disbursements executed during the gap need verification; (2) confirm UC gate states are accurate (a UC validated during the gap needs to be re-validated or the validation event replayed); (3) verify scheme budget utilization counters match sum of actual disbursements.
