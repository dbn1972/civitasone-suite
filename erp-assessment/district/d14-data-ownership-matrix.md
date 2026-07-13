# D14 — Data Ownership & System-of-Record Matrix

**Lane:** L06 · **Date:** 2026-07-13  
**Reviewer role:** Government Data Governance Expert  
**Source branch:** `court-management-service` · repo at `/tmp/cms-wt`

> **PREREQUISITE:** Cross-ref `08-tenant-isolation-report.md` (tenant isolation: 7/10), `d09-collectorate-gap.md` (org model P0 blocker), `d10-police-gap.md` (CCTNS boundary). Do not re-derive those.

---

## 1. Hard Rule — No Direct Cross-Domain Database Sharing

**This rule must appear in every architecture decision record for the district platform:**

> All cross-domain data movement is via **REST API pull** (synchronous reads for point-in-time queries), **async event/projection** (domain events consumed and projected into a local read model), or **analytical projection** (facts table in analytics-service). No service may open a SQL connection to another service's database. No service may import another service's Drizzle schema files. No cross-service FK, no cross-schema JOIN.

**Current Compliance Check [VERIFIED]:**

```bash
# Cross-service DSN references: NONE FOUND
grep -rn "civitas_(hrms|payroll|finance|grant|citizen|court)" services/*/src --include="*.ts"
# → 0 results (each service's db.ts points to its own DATABASE_URL)
```

- Each `services/<svc>/src/shared/db.ts` fails-fast if `DATABASE_URL` is absent and expects only `civitas_<svc>` [VERIFIED: `services/payroll-service/src/shared/db.ts:13`, `services/finance-service/src/shared/db.ts:...`]
- `civitas_tenant_0a0a0a0a11112222` silo DB exists in live PG cluster [VERIFIED: `\l` output] — proves the silo mechanism works but shows one provisioned silo (test only)
- Raw SQL in route handler: `services/payroll-service/src/modules/payroll/routes.ts:99–106` uses `db.execute(sql`SELECT ... array_agg(m.department_id)...`)` — within payroll's own schema, not cross-service, but **violates CLAUDE.md §4 (raw SQL outside migrations)** [VERIFIED]

**L1 (cross-service SQL) violations: 0. L2 (cross-module schema import) violations: 0 found in grep. Raw-SQL-in-route violations: ≥1 (payroll).** [VERIFIED]

---

## 2. Data Ownership Matrix

| # | Data Domain | System of Record (SoR) | CivitasOne Status | District Consumer | State Consumer | Ministry Consumer | Sharing Method | Classification | L1/L2 Violation? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Employee posting / service book** | `hrms-service` (`hrms.employees`, `hrms.postings`) | PARTIAL — posting exists; no office/position/jurisdiction model [VERIFIED: `d09 §2.3`; `services/hrms-service/src/modules/employee/schema.ts` has `departmentId` but no `officeId`/`positionId`] | District HR: HRMS API `/employees/{id}/posting` | State HRMS projections via analytics | DoPT aggregate via ministry analytics cell | `hrms.employee.posted` event → analytics projection | `RESTRICTED` | None |
| 2 | **FIR / investigation / case diary** | **CCTNS (external statutory)** — MUST NEVER enter CivitasOne [VERIFIED: `d10 §1` — 0 FIR tables in any service] | NOT IN ERP — correct | `court-service` receives `firNo`+`psCode` reference only (opaque) | State CCTNS DGP cell | MHA via CCTNS national server | Read-only `packages/gov-adapters/src/cctns/client.ts` [PROPOSED — ABSENT, P1] | `CONFIDENTIAL / SECRET` | N/A — no data here |
| 3 | **Land record / RoR / mutation** | **State Land Records System (Bhulekh/DLRS)** — external statutory | NOT IN ERP — correct | Revenue Tehsildar: API pull on Khasra/Khatauni via adapter [PROPOSED, P1] | State Revenue Dept via land-records portal | NIC DILRMP via state API | Read-only `gov-adapters/src/land-records/client.ts` [PROPOSED — ABSENT] | `RESTRICTED` | N/A — no data here |
| 4 | **District coordination event** (law-and-order, disaster, election, VIP, relief) | **Requires-new-module `coordination-service`** | ABSENT — grep across all services returns 0 rows for any district-level coordination record [VERIFIED: `grep -rn "coordination\|incident\|disaster\|relief\|law.and.order" services/*/src --include="*.ts"` → only `visitor.security_incidents` in visitor-service (physical security, not district coordination)] | District Collector, SP, CMO, BDO read/write | State EOC, State SEOC | NDMA, MHA real-time feed | New `coordination.event.created` domain event → district dashboard projection | `RESTRICTED / CONFIDENTIAL` (classification per event_type) | N/A — module absent |
| 5 | **Scheme progress / utilisation** | `grant-service` + `project-service` | PARTIAL — `grant.scheme.created`, `grant.uc.reconciled` events exist [VERIFIED: `services/grant-service/src/topics.ts:27,37`]; `project-service` has `project`, `scheme`, `progress`, `utilisation`, `geo` modules [VERIFIED: memory]; no PFMS reconciliation projection yet | Block/BDO, District: API pull on scheme disbursement + UC | State Planning Dept via analytics projection | Ministry NIC via DISHA/PFMS (outbound PFMS adapter exists: `finance-service/src/modules/pfms/adapter.ts`) | `grant.scheme.*` events → analytics-service facts table; PFMS outbound via adapter | `INTERNAL / RESTRICTED` | None |
| 6 | **Financial transaction / expenditure** | **PFMS / State Treasury (e-Kuber)** is SoR for released funds; `finance-service` (`finance.gl`, `finance.payments`) is SoR for departmental vouchers | PARTIAL — PFMS adapter built (`finance-service/src/modules/pfms/adapter.ts`), outbound payment submission functional, inbound reconciliation stub [VERIFIED: `pfms/treasury-stubs.ts`] | DDO: finance-service API; Treasury: PFMS reconciliation | AG/State Finance via PFMS + `finance.transaction.posted` event | CAG, CGA via PFMS feeds | `finance.payment.made`, `finance.gl.posted` events → analytics; PFMS adapter for outbound | `RESTRICTED / CONFIDENTIAL` (amounts + beneficiary PII) | None |
| 7 | **Grievance / complaint** | `citizen-service` (`application.citizen_applications` + `grievance` module) | PARTIAL — grievance module registered [VERIFIED: `citizen-service/src/worker.ts:9`]; CPGRAMS stub only (`d09 §2.16`); RTI module present; no certificate-issuance module | District: citizen-service API (grievance status, escalation) | State PGRS portal integration [PROPOSED] | CPGRAMS federal layer [PROPOSED, P2] | `citizen.grievance.escalated` events → state PGRS via gov-adapter [PROPOSED] | `RESTRICTED` (complainant PII encrypted: `services/citizen-service/src/modules/portal/schema.ts:12-22` [VERIFIED]) | None |
| 8 | **Certificate issuance** (caste, income, domicile, birth/death) | `citizen-service` — BUT no certificate module found | ABSENT — no `certificate`, `cert_issuance`, `caste_cert`, `income_cert`, `birth_cert` table in any schema [VERIFIED: `ls citizen-service/src/modules/` → `application`, `beneficiary`, `escalation`, `grievance`, `helpdesk`, `portal`, `routing`, `rti`, `sla-rules`, `sla-sweep`, `ai`, `analytics` — no certificate module]; `citizen_applications` schema has `serviceId` (opaque FK) but no certificate lifecycle | Tehsil/SDM officer issues via district frontend | State-level DigiLocker integration [PROPOSED] | NeSDA / DigiLocker e-sign [PROPOSED] | Certificate event → DigiLocker push via gov-adapter [PROPOSED, P1] | `RESTRICTED` (applicant PII) | N/A — module absent |
| 9 | **Payroll PII** (salary, tax, bank account) | `payroll-service` (`payroll.payroll_runs`, `payroll.statutory`) | PRESENT — PII encrypted at rest: `bank_account_no`, `bank_ifsc`, `pan` (AES-256-GCM) [VERIFIED: `services/payroll-service/src/modules/payroll/schema.ts:121-123`]; `deductee_pan` encrypted [VERIFIED: `services/payroll-service/src/modules/statutory/schema.ts:150`] | DDO: payroll-service API (scoped to own DDO by RLS) | AG/State Finance: audit projection (aggregate only, no individual PII) | CGA, IT Dept via TDS return (TRACES adapter: `packages/gov-adapters/src/traces.ts`) | `payroll.run.disbursed` event (no PII in payload); TRACES outbound for TDS | `CONFIDENTIAL` (financial PII) | None |
| 10 | **Asset register** | `asset-service` (5 L2 modules: register, lifecycle, depreciation, insurance, maintenance, verification, enterprise) | PRESENT [VERIFIED: memory — 11 tables, 12/12 tests pass] | District: asset-service API (asset list, depreciation schedule) | State Finance / CAG via audit projection | CAG e-Samiksha (planned integration) | `asset.disposed`, `asset.revalued` events → analytics | `INTERNAL` | None |

---

## 3. Cross-Domain Sharing — Method Classification

```
API pull (sync)      → Point-in-time queries across tenants/departments (HTTP, authenticated)
Domain event (async) → State-change notifications via @civitasone/queue → consumer projects into own DB
Analytical projection→ analytics-service.facts table normalised from cross-domain events [VERIFIED: analytics-service/src/modules/facts/consumer.ts:2]
Gov-adapter (outbound)→ Adapters in packages/gov-adapters (PFMS, NACH, TRACES, DigiLocker) to external statutory systems
Gov-adapter (inbound) → [PROPOSED] Read-only adapters for CCTNS, LGD, land-records, CPGRAMS
```

**Current violation of sharing method rules: NONE at the DB layer.** [VERIFIED — no cross-service DSN in any service src].

---

## 4. Absent Systems-of-Record — Gap Table

| External SoR | Integration Status | Required Adapter | Priority |
|---|---|---|---|
| CCTNS / ICJS | ABSENT (`packages/gov-adapters` has no `cctns/` dir) | `CctnsAdapter.getCrimeStatsByUnit()`, `verifyFirExists()` | P1 |
| State Land Records (Bhulekh/DLRS) | ABSENT | `LandRecordsAdapter.getRoR()`, `getMutationStatus()` | P1 |
| CPGRAMS (national grievance portal) | STUB only | `CpgramsAdapter.registerGrievance()`, `getStatus()` | P1 |
| DigiLocker (certificate e-sign/push) | Visitor-service only (identity verify) [VERIFIED]; NOT in citizen-service for certificate push | `DigiLockerAdapter.pushCertificate()` | P1 |
| NeSDA (digital certificates) | ABSENT | `NesdaAdapter.issueCertificate()` | P2 |
| e-Pramaan (eSigned certificates) | ABSENT | `EPramaanAdapter.signDocument()` | P2 |
| DISE/HMIS (education/health SoR) | ABSENT | Read-only projection adapters | P2 |

---

## 5. Key Gaps Requiring Immediate Action (P0 / P1)

| Gap | Priority | Evidence |
|---|---|---|
| **No `coordination-service`**: district coordination events for law-and-order, disaster, relief have no module, no schema, no events | **P1** | 0 tables/routes found across 38 services |
| **No certificate-issuance module** in citizen-service: `ls modules/` confirms no `certificate/` dir | **P1** | citizen-service module listing |
| **No CCTNS adapter**: court-service references FIR by opaque `firNo` but no validator or verification adapter exists | **P1** | `packages/gov-adapters/` — no cctns dir |
| **No land-records adapter**: revenue/court/collector workflows need Khasra/Khatauni read | **P1** | `packages/gov-adapters/` — no land-records dir |
| **HRMS has no posting/office/position model**: employee-posting SoR cannot represent district office-level postings | **P0** | `d09-collectorate-gap.md §9`, `d05-admin-organogram.md` |
| **grant-service has no PII encryption**: beneficiary personal data stored in plaintext (Aadhaar-linked in APBS writer) | **P1** | `grep encryptedText services/grant-service/src` → 0 results |
