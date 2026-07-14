# CivitasOne — Remediation Tickets (for Kiro)

**Source:** autonomous ERP Testing Board, 2026-07-12, branch `court-management-service`.
**Full evidence:** `erp-assessment/` (00-final-verdict, 09-security-report, 10..14, 15-defect-register).
**Board verdict:** DEV ONLY / NOT PRODUCTION READY, overall 4/10. Two structural disqualifiers: (1) cross-tenant bypass — **now fixed**, see below; (2) no backup/PITR.
**How to use:** each ticket is self-contained (file:line + fix + acceptance). Do NOT re-do anything in "§0 ALREADY DONE". Run each service's suite with `QUEUE_DRIVER=memory`. Commit to a branch; the shared worktree auto-`git reset --hard`s.

---

## §0 — ALREADY FIXED / COVERED this session (do NOT redo)
- **SEC-P0-01 (gateway cross-tenant bypass) — FIXED & PROVEN, commit `2ba2911`.** `gateway/jwt-edge.ts` now unconditionally overwrites `x-tenant-id` with the verified token `tid`; a forged header can no longer win. Regression test added (fails without fix). **This also neutralises the *exploit path* of SEC-P0-02** — since the header reaching services now always equals the verified token, a client can no longer forge it. SEC-P0-02's per-service hardening (below) is now defense-in-depth, not an acute hole.
- **Consumer WRITES under RLS — FIXED centrally, commit `6d64df7`.** `queue-service createQueue` wraps every consumer in `withTenantConsumer→runWithTenant(msg.tenantId)`. So in the real (queue) path, all consumer writes now set the tenant GUC. **IMPORTANT for GR-FAIL/ID-FAIL/ESTAB-FAIL/ASSET-CONSUMER/PROC-GRN below:** many of those "consumer fails under RLS" TEST failures are likely test-harness gaps (the test seeds/invokes the consumer directly, bypassing the wrapped queue.subscribe) rather than production defects — verify by driving the real queue path or wrapping the test's seed/invoke in `runWithTenant` before concluding it's a code bug.
- **Read path + JWT tenant-source — FIXED for 8 services** (`5a76029` finance, `4fe84a2` billing+notification, `23f222d` workflow, `f0bffdd` hrms+identity, `3f3b149` payroll) plus court/visitor/meeting/analytics earlier. Each: `scopedRead` + a JWT-sourced onRequest hook, live-proven (bare read=0 → scoped=1 → cross-tenant=0).

---

## §1 — P0 (fix before ANY pilot)

| ID | Service · file | Problem | Fix | Accept |
|---|---|---|---|---|
| **SEC-P0-03** plugin RCE | plugin-service `src/modules/runtime/engine.ts:132` | `new Function(handler)` executes arbitrary user JS with full process access when `PLUGIN_RUNTIME_ENABLED=true`. Validator only `z.string().min(1).max(512)`. | Route hook execution through the EXISTING `plugin-service/src/modules/runtime/sandbox/runtime.ts` (worker_threads) instead of `new Function`. | A hook attempting `process`/`require`/fs access is denied; add a test proving sandbox escape fails. **Verify the finding first** (confirm the `new Function` path is actually reachable). |
| **BL-03** salary GL never posts | payroll `src/topics.ts` (EVENTS) vs finance `src/topics.ts` (CONSUMED_EVENTS) | Finance GL consumer subscribes to `payroll.run.finalized`; payroll emits `payroll.run.disbursed`. Topic mismatch → salary journal never posts to the ledger. | Align the topic: either payroll emit `payroll.run.finalized` OR finance consume `payroll.run.disbursed`. Confirm the exact strings by grep before editing. | A disbursed payroll run produces a balanced GL journal in finance (add an integration test). |
| **PAY-DEF01** ECR wage | payroll `src/modules/.../ecr-routes.ts:53-55` | ECR (EPFO return) uses `slip.basicMinor` for the wage columns; EPFO pensionable wage must be `min(basic+DA, ₹15,000)`. For basic 12000 + DA 5000 → ECR shows 12000 vs correct 15000 → **challan rejection for every 7th CPC employee**. | Replace `slip.basicMinor` with `Math.min(slip.basicMinor + slip.daMinor, 1_500_000)` (paise). | Independent-oracle test: basic 12000+DA 5000 → ECR wage = 15000; basic 8000+DA 2000 → 10000. |
| **SEC-P1-06** PAN/bank plaintext | payroll `src/modules/payroll/routes.ts:156-170` | Pensioner record insert uses raw `` sql`` `` template, bypassing the `encryptedText` (AES-GCM) Drizzle transform → PAN + bank acct stored in PLAINTEXT (DPDP violation). | Use the Drizzle ORM insert (via the schema's `encryptedText` columns) instead of raw SQL. | Query the row at the DB level → PAN/bank ciphertext, not plaintext. |
| **GR-FAIL** grant disbursement | grant-service consumers | 63% test fail; approval-gated disbursement paths write no rows; cross-tenant budget reservation broken. | FIRST determine real-vs-harness (see §0). If real: ensure the disbursement consumer runs under `runWithTenant` (or relies on the central wrap) AND its READS use `scopedRead` (grant not yet in the read-fixed set). Likely needs the same read+JWT pass as the 8 fixed services. | All 4 approval-gated disbursement flows create the expected rows; cross-tenant probe returns 0. |
| **ID-FAIL** identity | identity-service `tests/rls-isolation.test.ts`, tombstone consumer | 24% fail; tombstone/delete writes nothing; RLS isolation tests fail. Identity is the security perimeter. | identity already got the read+JWT fix (`f0bffdd`) — re-run its suite on latest; remaining failures are likely the tombstone consumer + test-harness. Fix tombstone consumer tenant context; resolve residual RLS tests. | Tombstone delete op recorded; RLS isolation suite green. |

---

## §2 — P1 (fix before production)

| ID | Service · file | Problem | Fix |
|---|---|---|---|
| **NOTIF-CRASH** | notification `src/modules/email/smtp-sender.js` (absent) | Email channel fails at startup (`Failed to load .../smtp-sender.js`). | Create/restore the missing module. |
| **ANALYTICS-BIGINT** | analytics `query-consumer` | Decimal string `"250.00"` inserted into a `bigint` column → crash → financial KPIs zero. | `BigInt(Math.round(Number(amount)*100))` (to paise) before insert, or make the column `numeric`. Confirm the intended unit. |
| **PAY-DEF... salary-topic** | (see BL-03) | — | — |
| **ESTAB-FAIL** | estab-service (eOffice) | 20% fail: DSP sequence returns `undefined`; NAI archival status unset; approval callbacks write nothing → **blocks ALL eOffice approval routing** (procurement sanction, HR promotion/transfer, grant approval). | Fix DSP number generator (sequence consumer); wire eOffice approval callbacks; NAI workflow consumer. Check real-vs-harness (§0). |
| **SEC-P1-01** payslip IDOR | payroll `src/modules/payslip-pdf/routes.ts:79-89` | `employee` role in READER_ROLES with no ownership check → any employee downloads any co-worker's payslip (gross/net/PAN/IFSC/UAN). | Add `enforceEmployeeOwnership(ctx, slip?.employeeNo)` after `requireRole`. |
| **SEC-P1-09** hardcoded BYPASSRLS pw | visitor `migrations/0009_scanner_role.sql:27`, meeting `migrations/0007_*.sql:28` | Plaintext `*_dev_pw` for BYPASSRLS scanner roles committed to git (⚠ introduced this session). | Generate the role password from the secrets manager at provision time; remove the literal. Also add these `_scanner` roles' password rotation to infra bootstrap. |
| **SEC-P1-07/08** SSRF | telephony `webhooks/routes.ts:143`, legal (eCourts `downloadUrl`) | Fetch to unvalidated external URL from webhook/API response → SSRF to internal/metadata. | Allowlist host (`*.twilio.com`, eCourts domain) before fetch/enqueue. |
| **ASSET-CONSUMER** | asset-service register consumer | RLS violation on every asset creation → capitalisation/disposal broken (8 GL cascade fails). | Same class as §0 — verify real-vs-harness; asset not in the read-fixed set, likely needs read+JWT pass. |
| **INV-MIGRATIONS** | inventory-service | `cycle_counts`, `cost_layers`, `warehouses` tables missing from `civitas_inventory` → routes 500. | Author + apply the missing migrations. |
| **METADATA-STUB** | metadata-service | No routes/topics/worker/gateway entry → custom-entity API absent. | Implement minimal routes.ts + topics + worker + gateway registration, OR de-scope for pilot. |
| **DQ-HRMS / DQ-FIN / DQ-PAY** | dev data | 50/50 employees missing `pay_structure_id` (payroll can't compute); 50 bigint-test rows in `gl.finance_ledger` distort all reports; payroll run 2024-12 total ≠ slip sum (−₹30k). | Data hygiene: seed `pay_structure_id`; **delete the `BIGINT-TEST-V001-*` GL rows** + add `CHECK debit_minor < 10^12`; recompute run totals + add a `run.total == SUM(slips)` trigger. |

---

## §3 — Coordinated tracks (systematic, not one-off)
- **RLS-readiness Wave 2** (my ongoing plan): ~23 services still read `x-tenant-id` and need the `scopedRead` + JWT-hook pass (grant, asset, estab, procurement, contract, citizen, audit, admin, etc. — same proven pattern as the 8 done). Plus route-level bare `db.execute` writes (finance 3, hrms 61, identity 16), and **set `workflow_svc` DB role to NOBYPASSRLS** in infra bootstrap. I can continue this or Kiro can — coordinate so we don't both touch the same service.
- **Integration/choreography:** ~124 orphaned events; 6 broken topic linkages (BL-01/02/04/05/06 — analytics KPIs zero, LTC never paid, citizen notifications dropped); missing GL consumers (billing.invoice.paid, asset.asset.created). Wire per `07-integration-matrix.md`.
- **Backup/PITR (infra, disqualifier #2):** `wal_level=replica` + `archive_mode=on` + WAL→S3/Barman + nightly `pg_basebackup` + one hot standby. Uncomment the Terraform RDS module. ~2–3 infra days.
- **Audit field-level diffs:** finance/hrms/payroll consumers don't emit `oldValue`/`newValue` or actor role (CERT-In/DPDP gap).

---

## Suggested order (matches board's remediation roadmap)
1. §1 P0s (plugin RCE, BL-03, ECR, PAN plaintext) + verify grant/identity real-vs-harness.
2. Backup/PITR infra.
3. §2 P1 quick wins (smtp-sender, analytics bigint, payslip IDOR, hardcoded pw, inventory migrations, data hygiene).
4. §3 RLS Wave 2 + integration wiring.
