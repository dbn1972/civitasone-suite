# Kiro — CivitasOne District Governance Platform: 10/10 Task Plan

**Source:** District Governance Architecture Review Board 2026-07-13 (verdict 3/10, "Collectorate-internal-ERP-only").
**Evidence:** `erp-assessment/district/` on main (`bbd16e6`) — d00 verdict, d24 gap register (55 gaps), d26 roadmap, d28 scorecard, d05/d06 DDL sketches.
**Rules:** verify every gap against code before building (board ran on a smaller model); every task ships with a failing-before/passing-after test; commit per task with the TASK-ID; no destructive ops on shared data; run suites with `QUEUE_DRIVER=memory`.
**Sequencing is strict: Wave A (EPIC-1..3) is a hard gate — most later epics are blocked until the org model is in the DB and in the JWT.**

---

## A. Gap register — grouped summary (55 gaps)

| # | Gap area | Gap IDs | Severity | Priority | What's wrong |
|---|---|---|---|---|---|
| 1 | Org model & geography | G-01..06, G-25, G-31 | CRITICAL | P0 | Hierarchy/jurisdiction tables never migrated to DB; no offices/positions/postings entities; unit types hardcoded enum; police levels absent; no LGD adapter |
| 2 | Federated tenancy | G-07, G-55, G-10, G-22, G-50 | CRITICAL | P0 | No parentTenantId (state→district impossible); tenant-router + cell registry unwired; no pool→silo migration |
| 3 | Identity & access | G-08, G-09, G-39 | CRITICAL | P0/P1 | JWT/RequestContext carry no officeId/positionId/jurisdiction; ABAC evaluator never reads abac.rules; single Keycloak realm |
| 4 | Security domains & PII | G-12, G-13, G-24, G-38, G-43, G-45, G-47, G-48, G-18 | CRIT/HIGH | P0/P1 | workflow_svc BYPASSRLS; court DB owned by superuser; Wave-2 RLS pending ~23 services; kmsKeyRef=NULL; grant PII plaintext; police/treasury share Redis/S3/Meili; no gov integration gateway |
| 5 | Backup / DR / ops | G-11 | CRITICAL | P0 | Zero backup/PITR; production Terraform commented out; no DR playbook |
| 6 | Event backbone | G-17, G-41, G-42, G-44, G-40, G-51 | CRIT/HIGH | P0/P1 | Envelope missing 8 district fields; schema registry in-memory; payroll→finance GL topic mismatch; court consumes 0 events; 4 sync paths lack circuit breaker; audit lacks oldValue/newValue |
| 7 | Coordination & disaster | G-14, G-15, G-54, G-46, G-49 | CRITICAL | P0/P1 | No coordination-service (DM↔SP: force-requisition, Sec-144, bandobast); no disaster/SDRF/relief-camp module; no election module; no coordination read-model |
| 8 | Police administration | G-25, G-34, G-33 | CRIT/HIGH | P0/P1 | Police hierarchy unrepresentable; no duty-roster/deployment/arms-register; no CCTNS/ICJS read-only adapters |
| 9 | Scheme & ministry | G-19, G-20, G-21, G-52 | CRIT/HIGH | P0/P2 | Ministry is free-text; no scheme-registry; scheme.fund.released.v1 absent; PFMS inbound absent; no ministry portal push |
| 10 | Citizen statutory services | G-16, G-36, G-35, G-37, G-32 | HIGH | P0/P1 | CPGRAMS stub; no certificate issuance/service catalog; no licensing; no land-records adapter; no DigiLocker |
| 11 | Configurability / multi-state | G-30, G-23 | HIGH | P1 | metadata-service stub; module-guard unwired; state terminology hardcoded in 32/38 services |
| 12 | Quality debt | G-26..29, G-53 | HIGH | P1 | grant 63% / identity 24% / estab 20% test failures; smtp-sender missing; no state IFMS adapter |

Scorecard targets (current → 10): org-model 1, geography 2, SP-office 2, police-station 1, SDM/Tehsil 1, BDO/Panchayat 2, state-hierarchy 1, ministry 1, security-domains 2, identity 3, configurability 3, reliability 3, op-readiness 2, data-governance 3.

---

## WAVE A — FOUNDATION (P0 gate; nothing else works without this)

### EPIC-1 · Org Model & Administrative Geography  [G-01..06, G-25, G-31 | org-model 1→10, geography 2→10]
- **T1.1 Migrate hierarchy to DB** — run location-service Drizzle migrations so `hierarchy.administrative_units` + `jurisdiction.jurisdictions` exist in `civitas_location`. *Accept:* `\dt` shows both; CRUD round-trip test green.
- **T1.2 unit_types lookup table** — replace the hardcoded PG enum (`location-service/src/modules/hierarchy/validators.ts:4`) with per-tenant `hierarchy.unit_types` (INSERT-only). Seed: state, division, district, subdivision, tehsil, block, gp, village, ward, ulb, zone, range, circle, police_station, beat. *Accept:* adding a state-specific level requires INSERT, not DDL.
- **T1.3 offices / positions / postings DDL** — new tables per d05 §4.2–4.4: `hierarchy.offices` (officeType, adminUnitId, parentOfficeId, domain civil|police|revenue, lgdCode), `hierarchy.positions` (designation, office FK, financial/magisterial powers), `hierarchy.postings` (employee→position→office, effective_from/to, charge_type substantive|acting|additional). RLS on all three. *Accept:* seed a full pilot-district organogram (Collector→SDM→Tehsildar + SP→DSP→SHO) and query any officer's current office + jurisdiction.
- **T1.4 jurisdiction binding** — extend `jurisdiction.jurisdictions` with hierarchy_domain, jurisdiction_type, effective dates; bind offices→territory. *Accept:* "which SDM office covers village X on date D" resolves in one query.
- **T1.5 HRMS linkage** — add `to_office_id`/`to_position_id` to `hrms_transfers`; transfer consumer writes a posting row. *Accept:* an HRMS transfer produces a new effective-dated posting.
- **T1.6 LGD adapter** — `packages/gov-adapters/src/lgd.ts` (`resolveCode`, `getParent`, `syncHierarchy`); seed pilot-district hierarchy from LGD codes. *Accept:* tenant creation validates lgdCode.

### EPIC-2 · Identity, JWT & ABAC  [G-08, G-09 | identity 3→10]
- **T2.1 Extend claims** — `CivitasJwtPayload` + `RequestContext` (`packages/types/src/index.ts:71`) gain officeId, positionId, deptCode, hierarchyDomain, jurisdictionUnitIds[], delegationIds[], clearanceLevel.
- **T2.2 JWT enrichment at login** — identity-service resolves the user's ACTIVE posting (effective-dated) and stamps office/position claims. *Accept:* token for a posted SDM carries their officeId.
- **T2.3 Wire ABAC** — `evaluateDecision()` (`policy-service/src/modules/evaluate/domain.ts`) loads `abac.rules`; add jurisdiction/classification/purpose branches. *Accept:* rule "SDM sees only own-subdivision cases" enforced in a test.
- **T2.4 Gateway context propagation** — gateway injects x-office-id/x-position-id from verified token (same authoritative-overwrite pattern as the tid fix `2ba2911`).

### EPIC-3 · Federated Tenancy, Cells & Routing  [G-07, G-55, G-10, G-22 | state-hierarchy 1→10, scalability 4→10]
- **T3.1 Tenant federation columns** — add `parentTenantId` (FK self), `lgdCode`, `officeType`, `departmentCode`, `cellId` to `tenant.tenants`. *Accept:* State→District→Dept tenant chain queryable.
- **T3.2 Cell registry** — `install.cells` + `install.tenant_cell_placements` DDL (d16 §5.1) + placement API in install-service.
- **T3.3 Wire tenant-router** — replace the module-level `DATABASE_URL` singleton with `router.sqlFor(tenantId)` across all 38 services. *Accept:* a tenant flagged silo routes to a second PG DSN in a live test.
- **T3.4 Wire module-guard** — remove TODO at `gateway-service/src/module-guard.ts:12-14`; enforce `admin.admin_module_configs`. *Accept:* disabled module returns 403.

### EPIC-4 · Security Domains, RLS Completion & PII  [G-12, G-13, G-24, G-38, G-43 | security-domains 2→10, data-gov 3→10]
- **T4.1** `ALTER ROLE workflow_svc NOBYPASSRLS` + CI check that no service role has BYPASSRLS.
- **T4.2** `ALTER DATABASE civitas_court OWNER TO court_svc; REASSIGN OWNED BY civitas_admin TO court_svc`.
- **T4.3 RLS Wave-2** — apply the proven scopedRead + JWT-hook pattern to the remaining ~23 services; fix bare `db.execute` route writes (finance 3, hrms 61, identity 16). *Accept per service:* bare read=0 → scoped=1 → cross-tenant=0 under the real role.
- **T4.4 Per-tenant CMK** — wire `kmsKeyRef` → key lookup in `encryptedText()`; provision CMK per silo cell. *Accept:* two tenants' ciphertexts decrypt only with their own key.
- **T4.5 Grant PII encryption** — `encryptedText()` on beneficiary name/Aadhaar-ref/bank/mobile in grant-service. *Accept:* DB-level select shows ciphertext.
- **T4.6 security_domain column** — on hrms_departments + RLS gate blocking police↔civil reads.

### EPIC-5 · Backup, DR & Production Infra  [G-11 | reliability 3→10, op-readiness 2→10]
- **T5.1** Enable Terraform RDS (Multi-AZ) + WAL archiving to S3; automated backups. *Accept:* PITR restore drill recovers to point-in-time in <4h, documented.
- **T5.2** Enable ECS/ALB/ElastiCache production modules (`infra/aws/envs/production/main.tf:12-15`).
- **T5.3** DR playbook + on-call runbook + published RTO/RPO (treasury/police 30m RPO, shared 2h).
- **T5.4** Quarterly restore-drill CI job.

### EPIC-6 · Event Backbone Hardening  [G-17, G-41, G-42, G-44, G-40, G-51 | event-arch 5→10, audit 5→10]
- **T6.1 Envelope +8 fields** — extend `GovEventEnvelope` (`packages/events/src/envelope.ts:14-24`) with officeId, jurisdictionId, govLevel, district(LGD), state(ISO), department, classification, retentionPolicy (all optional = backward compatible).
- **T6.2 Fix payroll→finance GL topic** — `payroll.run.disbursed` vs `payroll.run.finalized` mismatch; integration test proves a disbursed run posts a balanced journal.
- **T6.3 Court event consumers** — wire `court.order.issued`→legal+notification; `finance.payment.made`→court fee receipts (court CONSUMED_EVENTS is `{}` today).
- **T6.4 Persist schema registry** — DB-backed (admin-service) instead of in-memory.
- **T6.5 Circuit breakers** — add to payroll→hrms, helpdesk→asset, stock→inventory, tenant→billing.
- **T6.6 Audit field diffs** — oldValue/newValue + actor role on every mutation consumer (CAG/RTI requirement).

---

## WAVE B — DISTRICT CAPABILITIES (needs Wave A)

### EPIC-7 · Coordination & Disaster Domain  [G-14, G-15, G-54, G-49, G-46 | collectorate 4→10]
- **T7.1 coordination-service (new)** — modules: event-permissions (procession/festival), force-requisition, Sec-144/magisterial orders, incident/control-room, after-action. Minimum-necessary shared record only (classification, participating_departments[], tasks[], resource_requirements[]) — NEVER full departmental case records.
- **T7.2 disaster module** — incidents, relief camps, affected households, SDRF fund tracking (DDL d09 §2.19), tehsil-level scoping.
- **T7.3 election module** — duty rosters, booth deployment, Sec-144 linkage, ECI adapter stub.
- **T7.4 10 coordination event topics** — district.event.*, police.assistance.*, disaster.incident.*, relief.camp.* per d19 catalogue, using the enriched envelope.
- **T7.5 coordination read-model** — DM's unified district view fed by classification=COORDINATION events only.

### EPIC-8 · Police Administration  [G-25, G-34, G-33, G-47 | SP 2→10, police-station 1→10]
- **T8.1 police-admin service (new)** — duty-roster, deployment/bandobast, arms & equipment register, station-inspection modules (DDL d10 §5.2–5.3); cadre columns (IPS/PPS, rank order) in HRMS.
- **T8.2 Police silo cell** — dedicated PG+Redis+S3+CMK+Keycloak realm per state; place police tenants via cell registry.
- **T8.3 CCTNS/ICJS read-only adapters** — `verifyFirExists()`, crime stats by unit, summons/warrant status. HARD RULE: FIR/case-diary/intel data must NEVER be stored in CivitasOne.

### EPIC-9 · Citizen Statutory Services  [G-16, G-36, G-35, G-37, G-32 | SDM/Tehsil 1→10]
- **T9.1 CPGRAMS inbound adapter** — fetchPending/updateStatus; route grievances by office+jurisdiction (add assigned_office_id, jurisdiction_unit_id to grievances).
- **T9.2 Certificate issuance** — service-catalog module in citizen-service (income/caste/domicile/OBC lifecycle) + DigiLocker push.
- **T9.3 licensing-service (new)** — arms/liquor/trade/explosive license types, verification workflow (SDM↔police clearance via coordination events).
- **T9.4 Land-records adapter interface** — state-pluggable (Bhulekh/Dharitri/…); revenue-court mutation reads current record; khasra refs stop being free-text.

### EPIC-10 · Scheme Registry & Ministry Federation  [G-19, G-20, G-21, G-52 | ministry 1→10, BDO 2→10]
- **T10.1 scheme-registry module** — canonical `gov_authorities` (kill the free-text `ministry` field), scheme_masters, targets, sanctions.
- **T10.2 `scheme.fund.released.v1`** — event chain: PFMS inbound → finance receipt voucher → grant disbursement tracking → UC chain.
- **T10.3 PFMS inbound adapter** — reconcilePayments/getFundRelease + finance consumer.
- **T10.4 State-aggregation read-model** — parent-tenant analytics projection (district→state→ministry KPIs); ministry NEVER touches district OLTP.
- **T10.5 IFMS/state-treasury adapter** — config-driven per state; voucher reconciliation.

### EPIC-11 · Configurability & Multi-State  [G-30 | configurability 3→10]
- **T11.1 Build metadata-service** — routes/topics/consumer/gateway entry (it's a stub: 5 tables, 0 routes); entity-type, field, layout, validation-rule APIs.
- **T11.2 Vocabulary migration** — sweep the 32/38 services with hardcoded designations/ranks/govt-level labels into config-registry/metadata (start with hrms dept-domain.ts, top-10 worst).
- **T11.3 District onboarding wizard** — install-service flow: LGD seed → tenant tree → offices/positions → module entitlements → workflow templates → dashboards (the d13 template, automated).

---

## WAVE C — QUALITY DEBT (parallel-safe, anytime)

### EPIC-12 · Test-Failure & Defect Burn-down  [G-26..29]
- **T12.1** grant-service 63% failures (disbursement approval consumer) → 16/16 green.
- **T12.2** identity-service 24% failures (org-unit authz, MFA, SCIM, WebAuthn).
- **T12.3** estab-service 20% failures + DSC e-sign path.
- **T12.4** notification smtp-sender.ts (startup crash) + SMTP env wiring.

## WAVE D — SCALE-OUT (P2/P3)
- **T13** Treasury silo cell (WORM S3 Object Lock, 15m RPO) · pool→silo data-migration pipeline (CDC→bulk→reconcile→cutover) · per-cell Keycloak federation · ministry portal push adapters · government integration gateway hardening (classification filter, purpose-code, mTLS, replay protection) · 1000-TPS load test + published capacity envelopes.

---

## Definition of 10/10 (score gates per d28)
Each dimension reaches 10 only with LIVE evidence: org model queried in DB with effective-dated postings; office-scoped JWT enforced by ABAC test; PITR drill documented; police cell physically isolated (separate DSN/Redis/bucket proven); all 38 services RLS-proven under real roles; event envelope carrying classification end-to-end; zero hardcoded state vocabulary in the top-10 services; all suites green + `tsc --noEmit` 0 per service. **Existence ≠ points — every claim needs an executed test or live query.**

## Reporting
After each epic: `task | status (DONE/NOT-A-BUG/BLOCKED) | commit | proving test | note`. Never claim DONE without before/after evidence.
