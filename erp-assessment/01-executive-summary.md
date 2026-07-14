# 01 — Executive Summary
# CivitasOne Suite — ERP Testing Board Assessment

**Assessment date:** 2026-07-12  
**Branch assessed:** `court-management-service`  
**Testing Board lanes completed:** 13 of 13 (02–14 — all delivered)  
**Test corpus:** 10,671 automated tests executed across 38 services  
**Verdict:** **Dev only — Not production ready in current state**

---

## 1. What Is Actually Implemented

CivitasOne is a **genuine microservices ERP** — not a distributed monolith. It consists of 38 independent Fastify services, each with its own Postgres 16 database (per-service least-privilege DSN), its own migrations, and its own worker process. 559 tables total across 37 data services. The architecture is correct and the domain logic substrate is strong.

### Services by Status (38 total)

| Status | Count | Services |
|--------|-------|---------|
| **COMPLETE** | 10 | court-service (★ gold-standard), meeting-service (★ gold-standard), visitor-service, knowledge-service, ml-service, plugin-service, install-service, gateway-service (infra), queue-service (infra), theme-service |
| **NEAR-COMPLETE** | 7 | analytics-service, inventory-service, legal-service, location-service, project-service, stock-service, workflow-service |
| **PARTIAL** | 17 | admin, asset, audit, billing, citizen, contract, crm, finance, helpdesk, hrms, notification, payroll, policy, procurement, report, telephony, tenant |
| **HIGH-RISK** | 3 | estab-service (20% failure rate; 19/26 test files fail), grant-service (63% failure; all disbursement paths fail), identity-service (24% failure; tombstone/delete broken) |
| **STUB** | 1 | metadata-service (5 DB tables, zero API surface, no routes, no consumers) |

The three gold-standard services (court, meeting, visitor) demonstrate what the full platform can deliver: property-based tests, cross-tenant isolation probes, negative paths, SOD enforcement, consumer idempotency, and worker integration. These establish the quality bar for the rest.

---

## 2. Which Modules Are Complete / Partial / Stub

### Complete Modules
- **Court management** (§5–§35.5 CPC/NIC): case registration (idempotent UUIDv5 CNR), case lifecycle, hearings, orders (maker-checker + DSC), appeals, evidence (SHA-256 tamper-evidence), cause-list, certified copies, public lookup (OTP/captcha), DPDP PII at rest (AES-256-GCM). 285/322 tests pass (37 skipped E2E).
- **Governance meetings**: Full board/committee lifecycle, statutory frequency checks, STV/weighted/simple voting, quorum-resume, tenure expiry, AI-assist, VC integration, PII crypto. 1,147/1,147 tests pass.
- **Visitor management**: Pre-registration, digital passes (QR/JWT + AES-256-GCM), blacklist screening, evacuation, device registry, DPDP purge. 317/317 tests pass.
- **Workflow engine**: BPMN/DMN, XOR/AND/parallel, call-activity with cycle detection, SLA escalation, deemed-approval, delegations, simulation. 537/539 tests pass.

### Partial Modules (core logic correct; integration or consumer gaps)
- **Finance**: Domain layer gold (12/14 invariants verified; double-entry, period close, reversal, immutability, GFR Rules 10+11, maker-checker all proven). Blocked: instruments repo bypasses `db.transaction()` (5 test failures); salary GL journal never posts (broken topic BL-03).
- **Payroll**: Engine mathematically correct (90/90 oracle field matches across 8 statutory cases). Blocked: ECR wage column defect (EPFO filing rejection); LOP consumer queue-path failure; 6 test files fail with RLS violations.
- **HRMS**: Leave rules, disciplinary state machine, pension CCS, APAR grading, reservation engine all verified. Broken: geo-attendance E2E (7/9 fail), Disciplinary Rule 14 (3/3 fail), 59 tests skipped.
- **Procurement**: GFR two-bid tender lifecycle, sealed bid integrity, SOD, finance commitment gate, GeM adapter, 3-way match, vendor PII — all tested. Broken: GRN consumer write path (RLS); 14 tests skipped.
- **Inventory**: WAVG/FIFO engines (property-tested), 3-way match, cycle count, batch tracking — all correct. Missing: 3 DB tables not migrated (`cycle_counts`, `cost_layers`, `warehouses`), causing 500 on those routes.

### High-Risk / Broken
- **Grant-service**: Approval-gated disbursement completely non-functional (all 4 paths fail; 63% failure rate). Government fund release to beneficiaries is impossible.
- **Identity-service**: Tombstone/delete broken; cross-tenant RLS isolation tests fail. This is the platform's security perimeter.
- **Estab-service** (eOffice): DSP sequence numbering returns `undefined`; NAI archival not working; eOffice approval wiring absent. Entire document management workflow is blocked.

### Stubs
- **metadata-service**: 5 tables, 1 safe expression rule engine — but zero HTTP routes, no topics.ts, no worker, no gateway registration. Custom entity/field management does not exist.

---

## 3. Broken and Missing Integrations

### Critical Broken Topic Linkages (6)

| ID | Broken Connection | Impact |
|----|------------------|--------|
| BL-03 | `payroll.run.finalized` subscribed by finance GL consumer but payroll only emits `payroll.run.disbursed` | **Salary GL journal never posts** — finance ledger permanently missing all payroll cost entries |
| BL-01 | Analytics subscribes to `finance.payment.released`; finance only emits `finance.payment.made` | All analytics payment KPIs perpetually zero |
| BL-02 | Analytics subscribes to `grants.release.processed`; grant emits `grant.disbursement.completed` (namespace mismatch) | Grant disbursement KPI always zero |
| BL-04 | Meeting subscribes to `hrms.employee.updated`; hrms never emits it | Committee membership cache stale |
| BL-05 | Payroll subscribes to `hrms.claim.approved`; hrms never emits it | LTC claim payouts never triggered |
| BL-06 | Notification subscribes to `citizen.request.created`; citizen never emits it | Citizen request notifications silently dropped |

### Critical Missing Cross-Service Consumers

- `billing.invoice.paid` → finance GL consumer: **missing** (revenue not booked)
- `asset.asset.created` → finance GL consumer: **missing** (asset capitalisation journal never posted)
- `inventory.stock.low` → procurement: **missing** (low-stock never triggers auto-reorder)
- `court.order.issued` → legal-service + notification: **missing** (court orders invisible to legal and parties)
- Access-control mutations (identity RBAC, policy binding, admin break-glass) → audit: **missing** (CERT-In/DPDP §5 compliance gap)

### Orphaned Events
Approximately **124 domain events** are produced but have no registered consumer anywhere in the mesh (~35% of intended signal coverage is actually wired).

---

## 4. Is Tenant Isolation Proven?

**Partially proven — materially improved, not yet uniform.**

**What is proven:**
- DB isolation is fail-closed (FORCE RLS + NOBYPASSRLS on all per-service roles); no cross-tenant data leak was found in any probe
- Central write-fix deployed: all ~30 services' consumer writes now establish tenant context via `withTenantConsumer→runWithTenant` — live-proven as real NOBYPASSRLS role
- 12 services have JWT-source read-path fix: bare read = 0 rows → scoped read (tenant A GUC) = 1 row → tenant B GUC = 0 rows (isolation confirmed)

**What is NOT yet proven:**
- **Critical:** SEC-P0-01 + SEC-P0-02 together = any authenticated user can forge `x-tenant-id: <victim>` and the gateway forwards it; 25/38 services also use this forged header to set the RLS GUC. Full cross-tenant DB bypass is possible for any authenticated user.
- ~23 services still need Wave 2 read + JWT-hook fix (fail-closed but reads return empty, not confirmed isolated)
- Route-level direct DB writes (bare `db.execute`) in finance (3), hrms (61), identity (16) bypass the GUC-setting wrapper

**Summary:** Tenant isolation is architecturally correct and fail-closed, but contains a P0 security bypass that completely negates the DB-layer protection for any determined attacker. Must be fixed before any multi-tenant deployment.

---

## 5. Do Payroll / Finance / Inventory Reconcile?

### Finance: YES (with caveats)
- All 14 financial invariants testable: 12/14 green under executed evidence (T1+T2+T3)
- Double-entry enforcement, GL immutability (REVOKE + trigger), period close controls, reversal as contra-creation, HoA structure, GFR Rules 10+11 — all proven
- Balance sheet equation closes exactly for the test tenant
- **Caveat 1:** Instruments repo bypasses `db.transaction()` → all cheque/DD lifecycle blocked by FORCE RLS
- **Caveat 2:** 50 bigint-test rows distort all GL aggregate queries in the dev DB
- **Caveat 3:** Salary GL journal never posts (BL-03 broken topic)
- **Finance score: 8/10**

### Payroll: MOSTLY YES (ECR exception)
- Independent oracle: 90/90 field matches across 8 statutory cases (basic+DA, PF ceiling at ₹15k, new-regime TDS slabs, LOP, protected-net floor, gratuity CCS Rules, pension, off-cycle)
- NACH bank transfer (67 tests pass), Form 16 (PDF + bulk), deduction registers (PF/ESI/TDS/GPF/NPS), payroll→finance GL event emission — all correct
- **Exception:** ECR wage column uses `basicMinor` only, not `basic+DA`; causes EPFO challan reconciliation mismatch and filing rejection for all 7th CPC government employees (a one-line fix)
- **Exception:** LOP consumer queue-path broken (domain-level mock passes; real queue path fails)
- **Payroll score: 7/10**

### Inventory: YES (with missing table caveats)
- Inventory reconciliation invariant proven in both pure (replay) and real-DB (live Postgres consumer) forms: `Σqty_in − Σqty_out == closing_balance` holds for all 3 (item, store) pairs
- WAVG engine (bigint floor division), FIFO property test (8 fast-check property tests), 3-way match — all correct
- **Caveat:** `cycle_counts`, `cost_layers`, `warehouses` tables not present in DB — those routes return 500
- **Caveat:** Stock CQRS entry consumer write path broken (RLS); stock ledger can't be updated
- **Inventory score: 6/10**

---

## 6. Procurement Controls

**Verdict: Controls exist and are correct at domain level; integration is incomplete.**

**Working:**
- GFR two-bid tender lifecycle end-to-end (tech-eval → financial-bid sealed → open → L1 award)
- Sealed financial-bid integrity (amounts withheld until opened)
- Blacklisted bidder excluded from L1 determination
- SOD: award approver ≠ creator ≠ tech-evaluator (enforced and tested)
- Finance commitment gate: PO created only when funds available
- GFR financial bands (comparative statement)
- Award idempotency: re-delivered command does not re-award
- GeM adapter integration (mocked, correctly)
- Central debarment check
- Vendor PII encryption + access control
- Three-way match domain: PO/GRN/invoice variance with tolerance

**Not working / gaps:**
- GRN consumer write path blocked by RLS → three-way match cannot post GL entries
- PO amendment lifecycle untested (change-orders not covered)
- 14 skipped tests (E2E requiring live DB)
- `inventory.stock.low` → procurement indent not wired (auto-reorder missing)

---

## 7. Audit Completeness

**Verdict: Structural chain is sound and tamper-evident; field-level content is incomplete for financial mutations.**

**Working:**
- SHA-256 hash chain with per-tenant advisory lock: proven tamper-evident
- 180-day CERT-In retention (`retainUntil = now + 180 days`)
- Idempotent consumer: `markProcessed` → duplicate delivery produces exactly one record
- 262+ audit emission sites verified across all services
- Complete end-to-end chain verified for finance GL journal post (5 hops, all in-transaction) and identity session revoke

**Critical gaps:**
- Finance GL, budget, treasury, payroll run consumers do NOT emit `oldValue`/`newValue` — field-level diffs missing for every financial mutation (regulator cannot determine what changed)
- Actor roles never captured in audit payload
- Break-glass events, RBAC mutations, and policy binding events not forwarded to audit sink (CERT-In / DPDP §5 compliance gap)
- Plugin hook executions not audited

---

## 8. Security

**Score: 3/10 — Three P0 vulnerabilities independently catastrophic for multi-tenant government ERP**

**P0 findings:**
1. Gateway does not overwrite client-supplied `x-tenant-id` with JWT claim → any authenticated user can access any tenant's data
2. `createTenantTxHook` sources RLS GUC from raw header (not JWT) on 25/38 services → combined with P0-01, full DB isolation bypass
3. Plugin runtime `new Function(handler)` = server-side RCE when plugin runtime enabled

**11 P1 findings** including: payslip IDOR (employee reads any co-worker's salary data), PAN/bank account stored in plaintext (bypasses AES-GCM encryption), SSRF via Twilio webhook and eCourts API response, hardcoded BYPASSRLS DB credentials in git, inter-service auth silently swallowed.

**Positives:** JWT RS256 enforcement, no ignoreExpiration, rate limiting on auth endpoints, mass assignment blocked, SQL injection impossible (Drizzle), internal headers stripped at gateway.

---

## 9. Current Load Capacity

**Honest assessment: Not yet characterised by live load testing; architectural model projects the following:**

- Target (CLAUDE.md): 1,000 TPS sustained, 10M users
- Assessed (code inspection): **~100 TPS before noisy-tenant problems appear**

**Bottlenecks at current architecture:**
- Single payroll worker processes ~1–2 slips/second (4 DB queries + 1 HTTP call per employee); a 500k-employee payroll run takes ~14 hours on one worker
- Outbox relay: 100-row batch / 500ms interval → ~200 events/s per service maximum relay rate; 2.5s event delivery lag at 1,000 TPS
- Redis: single instance (no Sentinel wired); cache SPOF

**What scales:** SQS is not a bottleneck (unlimited throughput); DB-per-service means payroll surge doesn't lock finance; PgBouncer transaction-mode correctly configured; 1,453 indexes including tenant-leading composites on critical tables.

---

## 10. Future Scale Behaviour

**Year 1 (50 tenants, 50k employees, 250 GB total DB):** Manageable with current architecture if backup/PITR and Redis Sentinel are added. Worker scaling needed for payroll day.

**Year 2 (200 tenants, 500k employees, ~500 GB):** `hrms_attendance` partition urgently needed (will require hours-long lock without it). First large tenant (50k employees) needs silo tier (TenantRouter wiring). Audit archival cron to S3 needed. Payroll workers scaled to 3 replicas with HPA.

**Year 3 (1000 tenants, 5M employees, ~1.6 TB):** Cell deployment required. GL partitioned by fiscal year. Analytics service migrated to ClickHouse/BigQuery. Redis Cluster (not just Sentinel).

**Year 5 (9+ TB across 5–10 cells):** PITR across all cells; 5M-employee payroll requires 14+ parallel worker replicas; `payroll_slips` approaches 420M rows with 7-year retention.

The architecture is designed for this scale (TenantRouter, cell router, partitioned outbox) but none of the scale-enabling components are wired into production. The path is clear but requires ~12–18 months of infrastructure work.

---

## Summary Scorecard

| Dimension | Score |
|-----------|-------|
| Functional completeness | 7/10 |
| Business-rule correctness | 7/10 |
| HRMS | 6/10 |
| Payroll | 7/10 |
| Finance | 8/10 |
| Procurement | 6/10 |
| Inventory | 6/10 |
| Asset | 4/10 |
| eOffice | 3/10 |
| Court/Legal | 7/10 |
| Workflow | 8/10 |
| Cross-module integration | 4/10 |
| Multi-tenancy | 7/10 |
| Tenant isolation | 7/10 |
| Redis isolation | 7/10 |
| Authorization | 5/10 |
| Auditability | 7/10 |
| Data quality | 6/10 |
| API quality | 7/10 |
| Security | **3/10** |
| Performance | 6/10 |
| Scalability | 5/10 |
| Reliability | 7/10 |
| Backup/Restore | **3/10** |
| Test automation | 6/10 |
| Operational readiness | **3/10** |
| **OVERALL** | **4/10** |
