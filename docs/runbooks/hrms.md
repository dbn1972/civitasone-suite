# Runbook: hrms-service

> Tier 1. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 500 ms (see §3).

- **Purpose:** employee lifecycle (onboard → attendance → leave → confirmation/promotion/transfer/separation), recruitment, appraisal/APAR, medical claims, pension, GPF, service-book, geo-attendance, seniority, ID cards, reservation roster, and workforce planning. Owns `civitas_hrms` — the platform's largest test suite (271 tests, Tier 1 "production-ready").

- **Owner / escalation:** primary: HR domain owner. Secondary: SRE. Page immediately on any PII-decryption failure — a broken `pii-crypto` keyring blocks every employee-record read platform-wide, not just HRMS's own screens.

- **Dependencies:**
  - Own Postgres DB (`civitas_hrms`), RLS enabled.
  - Redis — read-through cache for employee/dashboard/roster queries.
  - SQS/RabbitMQ topics (`src/topics.ts`): the largest command surface on the platform — employee lifecycle, leave, attendance, appraisal, deputation, medical claims, LTC/CEA claims, pension, GPF, seniority, service-book, APAR, geo-attendance, holidays, ID cards, pay-matrix increment, reservation roster, workforce planning; events `hrms.employee.created/separated`, `hrms.leave.applied/approved`, `hrms.attendance.marked`.
  - **eOffice decision callbacks** (`modules/*/eoffice-consumer.ts`) — closes the approval loop for HR transfer, promotion, disciplinary, special-leave, and recruitment eFiles raised in estab-service (`hrms.transfer.file_decided`, `hrms.promotion.file_decided`, `hrms.disciplinary.file_decided`, `hrms.leave_special.file_decided`, `hrms.recruitment.file_decided`).
  - Consumed cross-service events: `tenant.tenant.created` (tenant-service, provisions default leave types/holidays for new tenants).
  - **`shared/payroll-client.ts`** — HTTP call to payroll-service (`PAYROLL_SERVICE_URL`, default :3013), wrapped in `@civitasone/circuit-breaker` — if payroll-service is down, HRMS degrades gracefully rather than blocking employee reads.
  - **Field-level PII encryption** (`shared/pii-crypto.ts`) — AES-256-GCM envelope as a Drizzle `customType`; every PII column (bank account, IFSC, PAN, Aadhaar, email, phone) is transparently encrypted at rest and decrypted on read. Supports keyring rotation (v1 legacy unsalted-SHA-256-derived key, v2 scrypt-derived with embedded key ID) so old ciphertext stays decryptable across `PII_ENC_KEY` rotations. This is the DPDP Act 2023 compliance backbone for the entire employee master.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay failures) via `registerOpsRoutes`.
  - Grafana: p95 read latency (500ms target), geo-attendance check-in success rate, leave-approval turnaround, appraisal-cycle completion rate.

- **Common failure modes → action:**
  - *Consumer stalled* (heartbeat stale on `hrms-worker`) → restart worker; inspect last message on the employee/leave/attendance command topics; check DB connectivity.
  - *DLQ filling* → read DLQ `error`; poison (validation) → fix upstream; transient → redrive after dependency recovers.
  - *PII decryption errors (`enc:v1`/`enc:v2` envelope failures)* → check `PII_ENC_KEY`/`PII_ENC_SALT` env config first — a rotation that dropped the prior key from the keyring will break every old-envelope read; this is a P0, not a routine DLQ issue. Never log the raw ciphertext or decrypted value while diagnosing.
  - *payroll-client circuit breaker open* → confirm payroll-service is genuinely down (check its own runbook) before assuming an HRMS bug; HRMS should still serve employee reads with payroll-derived fields degraded/omitted, never a 500.
  - *eOffice callback not landing* (e.g. transfer approval never updates employee record) → check the specific `*-eoffice-consumer.ts` module's outbox relay lag and confirm estab-service actually published the `file_decided` event for that `source_ref_type`.
  - *401 spike* → check Keycloak/JWKS reachability and `INTERNAL_SERVICE_SECRET`.
  - *p95 read latency high* → check Redis hit rate on employee/dashboard queries first; HRMS's PII decryption adds per-row CPU cost, so a cache miss storm compounds latency more than on non-PII services.

- **Rollback:** redeploy previous image tag; migrations are forward-only — never auto-rollback schema. Never roll back a `PII_ENC_KEY` rotation without confirming the keyring still contains every key ID referenced by existing `enc:v2:<keyid>:` envelopes.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox; verify audit continuity; confirm PII decryption succeeds across a sample of restored employee records (bank account, PAN, Aadhaar) before declaring recovery complete — a silent decrypt failure post-restore is worse than a slow restore.
