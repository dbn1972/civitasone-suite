# CivitasOne ERP — World-Class Integration Test Master Prompt

## Purpose
This prompt file is designed for AI agents (Claude) to execute comprehensive end-to-end functionality testing of all 41 microservices with mock data seeding, multi-tenant isolation verification, and cross-service choreography validation.

---

## Test Strategy Overview

### Organisations to Seed (3 tenants testing multi-tenancy)

| Tenant | Type | Edition | Use Case |
|--------|------|---------|----------|
| `tenant-alpha` | State Government Department | Enterprise | Full module testing (all 22 modules enabled) |
| `tenant-beta` | PSU (Public Sector Unit) | PSU | Mid-tier testing (12 modules) |
| `tenant-gamma` | Small Office (Block Office) | Small Office | Minimal modules (6 core) |

### Test Actors per Tenant

| Role | Actor ID Pattern | Permissions |
|------|-----------------|-------------|
| Super Admin | `actor-{tenant}-superadmin` | Everything |
| Finance Officer | `actor-{tenant}-finance` | Finance, Budget, Payments |
| HR Admin | `actor-{tenant}-hr` | HRMS, Payroll, Establishment |
| Procurement Officer | `actor-{tenant}-procurement` | Procurement, Contracts |
| Citizen | `actor-{tenant}-citizen` | Citizen portal, RTI, Grievance |
| Employee | `actor-{tenant}-employee` | Self-service, Leave, Attendance |
| Auditor | `actor-{tenant}-auditor` | Audit trail read-only |

---

## Module-by-Module Test Plan (27 Modules)

### Module 1: eOffice, Correspondence & Meetings
**Services:** meeting-service, estab-service
**Test Scenarios:**
1. Create meeting with agenda → verify meeting-core, agenda, participant modules
2. Record attendance → verify quorum calculation
3. Record decisions → verify decision-log and action-item assignment
4. Create eFile (correspondence) → verify file noting, green notes, approval chain
5. Schedule committee meeting → verify calendar integration
6. Verify DSC (digital signature) on file noting
7. Test meeting minutes generation
8. Verify action-item tracking and escalation
9. Cross-tenant isolation: meeting in tenant-alpha NOT visible to tenant-beta
10. Video conference integration link generation

### Module 2: Learning, Knowledge & Support
**Services:** knowledge-service, helpdesk-service
**Test Scenarios:**
1. Create knowledge article with categories → verify search indexing
2. AI-powered search → verify relevance ranking
3. Create helpdesk ticket → verify SLA timer starts
4. Escalate ticket → verify notification sent
5. Knowledge base versioning (edit article → new version)
6. AI assistant "ask" → verify contextual response
7. Ticket resolution → verify SLA compliance tracking
8. Document retention policy enforcement
9. Cross-service: helpdesk ticket links to knowledge article
10. Compliance training completion tracking

### Module 3: Citizen Services, Grievance & Delivery
**Services:** citizen-service
**Test Scenarios:**
1. Citizen submits RTI application → verify 30-day SLA tracking
2. Citizen submits grievance → verify auto-assignment to department
3. Service request lifecycle: submit → assign → process → deliver
4. Track request status via tracking link
5. Appeal against rejection → verify escalation
6. Certificate issuance (birth/death/income/caste)
7. Fee payment for service → verify receipt generation
8. Eligibility check before application
9. Document upload and verification (DigiLocker pull)
10. Catalogue browsing → service discovery

### Module 4: Communication & Notification
**Services:** notification-service
**Test Scenarios:**
1. Send email notification → verify delivery record
2. Send SMS (fail-closed without Twilio config) → verify error logged
3. In-app notification via SSE stream → verify real-time delivery
4. Schedule notification for future → verify sweeper picks it up
5. Digest: accumulate 5 notifications → verify single digest sent
6. DND: set window → verify notification held during window
7. Priority: critical notification bypasses DND
8. Template with MJML → verify HTML compilation
9. Webhook delivery with HMAC signature → verify X-Signature-256
10. Analytics: tracking pixel → verify open event recorded
11. i18n: send in Hindi locale → verify correct template variant
12. Approval: submit template → maker-checker → publish
13. Segment: resolve recipient segment → verify matching recipients

### Module 5: HRMS & Establishment
**Services:** hrms-service
**Test Scenarios:**
1. Create employee → verify service book entry
2. Apply leave → approve → verify balance deduction
3. Mark attendance (geo-fenced) → verify within geofence
4. Run appraisal cycle → multi-stage review
5. Transfer employee → eOffice file → approval → execute
6. Pension initiation → calculation → PPO generation
7. GPF advance → interest calculation
8. Seniority list generation → verify roster point
9. Contract employee lifecycle: create → activate → renew → terminate
10. LTC/CEA claim: submit → approve → disburse
11. Workforce planning: vacancy forecast
12. AI fraud detection on attendance patterns
13. Competency assessment → skill gap analysis
14. 360° feedback cycle: nominate → collect → aggregate
15. Bulk import employees (CSV) → verify validation

### Module 6: Project, Works & Programme Management
**Services:** project-service, works-service
**Test Scenarios:**
1. Create project with milestones → verify timeline
2. Record physical progress → verify percentage
3. Upload geo-tagged site photo → verify coordinates
4. Delay forecast (ML prediction) → verify risk score
5. Fund release to scheme component → verify utilisation tracking
6. UC (Utilisation Certificate) generation → verify amounts match
7. Critical path calculation → verify task dependencies
8. Board-intake: meeting decision → project creation
9. Evidence upload for milestone completion
10. Financial progress vs physical progress comparison

### Module 7: Inspection, Compliance & Field Ops
**Services:** audit-service, visitor-service, inspection-service
**Test Scenarios:**
1. Create audit plan → schedule inspection
2. Record observation → draft para → issue audit para
3. Visitor check-in → badge print → check-out
4. Blacklist screening during visitor scan
5. Emergency evacuation drill → verify roster notification
6. Vehicle pass issuance → gate entry validation
7. Compliance control status tracking
8. Risk register: create risk → assess → mitigate
9. Hash-chain tamper-proof audit trail verification
10. Visitor analytics: daily trends, peak hours

### Module 8: Workflow, Rules & Approvals
**Services:** workflow-service
**Test Scenarios:**
1. Deploy BPMN workflow definition
2. Start workflow instance → task created for assignee
3. Complete task → advance to next step
4. Parallel gateway: both paths execute simultaneously
5. DMN decision table: evaluate business rule
6. Delegation: delegate authority for 7 days
7. External task: fetch-and-lock → complete externally
8. SLA calendar: verify business hours calculation
9. Authority matrix: verify approval level routing
10. Quorum check: require N approvers before advance
11. Version diff: compare BPMN v1 vs v2
12. Simulation: test workflow with mock data
13. DLQ: failed message → view → requeue

### Module 9: Payroll, Pension & Benefits
**Services:** payroll-service
**Test Scenarios:**
1. Run payroll for month → verify salary calculation
2. Generate payslip PDF → verify components
3. TDS calculation (7th CPC) → verify Form 16 data
4. NACH file generation for bank transfer
5. Form 24Q/26Q quarterly return generation
6. FnF (Full & Final) settlement on separation
7. Loan deduction from salary → EMI tracking
8. DSC signing on salary register
9. NPS (National Pension System) contribution file
10. Perquisite valuation components

### Module 10: Payments, Revenue, Collections & Subsidy
**Services:** billing-service, revenue-service, grant-service
**Test Scenarios:**
1. Generate invoice → e-Invoice (IRN via GSTN)
2. Payment initiation → gateway capture → reconciliation
3. Revenue collection: demand → collection → receipt
4. Grant application → approval → disbursement → UC
5. Subscription billing: plan → subscribe → invoice cycle
6. Proration on mid-cycle upgrade
7. Usage-based metering → invoice line items
8. Churn prediction → retention action trigger
9. Revenue write-off with approval chain
10. Beneficiary Aadhaar-linked disbursement (DBT)

### Module 11: Finance & Accounting
**Services:** finance-service
**Test Scenarios:**
1. Journal voucher entry → GL posting (double-entry)
2. Budget allocation → check → utilisation tracking
3. Bank reconciliation: upload statement → match → resolve
4. Cash book maintenance → daily closing balance
5. PFMS payment batch → bank file → DSC → submission
6. Anomaly detection on transactions (ML-flagged)
7. GST summary + ITC reconciliation
8. TDS vendor deduction → Form 26Q
9. Fixed asset depreciation schedule
10. Period close → freeze entries → financial statements
11. Treasury: deposit → adjust → refund → forfeit
12. Recurring journal template execution

### Module 12: Legal, Court, RTI, Vigilance & Audit
**Services:** legal-service, court-service
**Test Scenarios:**
1. Case registration → filing → hearing schedule
2. eCourts integration: pull case status
3. Cause list generation for upcoming hearings
4. RTI application: receive → process → respond within 30 days
5. Second appeal → escalation with deadline
6. Vigilance inquiry: create → investigate → close
7. Legal notice generation with template
8. Court order issuance → compliance tracking
9. Evidence management with chain-of-custody
10. Limitation tracking (statutory deadlines)

### Module 13: Procurement, Vendor & Contract Management
**Services:** procurement-service, contract-service
**Test Scenarios:**
1. Indent → tender → PO → GRN → 3-way match → bill
2. Vendor registration → KYC → blacklist check
3. GeM (Government e-Marketplace) integration
4. Contract creation → approval → e-Sign → activate
5. Contract renewal workflow (auto-detect expiry → initiate)
6. Rate contract: create → compare → PO against rate
7. Advance payment → debit note → adjustment
8. PO PDF generation → download
9. Vendor performance scoring
10. Auction/reverse auction flow

### Module 14: Budget, Treasury & Grants
**Services:** grant-service, finance-service
**Test Scenarios:**
1. Budget estimate preparation (BE/RE)
2. Budget allocation to DDO → spending authority
3. Grant scheme creation → component definition
4. Fund release → instalment tracking → disbursement
5. UC validation: expenditure vs allocation
6. Treasury challan generation → deposit
7. Re-appropriation between heads of account
8. Grant utilisation dashboard: scheme-wise spending
9. Beneficiary identification → Aadhaar seeding
10. Integration compliance check (GFR 2017)

### Module 15: Platform Ops, Reliability & DevOps
**Services:** admin-service, install-service
**Test Scenarios:**
1. Tenant provisioning → database creation → seed data
2. Feature flag: create → rollout 10% → 50% → 100%
3. Scheduled job: create → execute → verify output
4. Backup: trigger → verify → list backups
5. Webhook lifecycle: create → trigger → verify delivery
6. API key management: create → rotate → revoke
7. Data correction: propose → approve (maker-checker) → apply
8. Health check across all services
9. Change log: record deployment → notify
10. Platform config: set → version → rollback

### Module 16: Integration, API & Eventing
**Services:** gateway-service
**Test Scenarios:**
1. API request → gateway → proxy to upstream service
2. JWT validation at edge → reject expired token
3. Rate limiting: exceed 100 req/min → 429
4. Circuit breaker: upstream down → open circuit → 503
5. API key authentication (service-to-service)
6. Module guard: disabled module → 403
7. Response metrics collection (latency p95)
8. Reconciliation engine: run comparison → report breaks
9. Webhook replay on failure
10. Quota enforcement per tenant

### Module 17: Data, Search, Reporting & Analytics
**Services:** analytics-service, report-service, ml-service
**Test Scenarios:**
1. Record analytics event → query aggregation
2. Dashboard: widget data → real-time update
3. Report template: create → schedule → generate → download
4. KPI metric: define → track → alert on threshold
5. ML model: register → train → evaluate → promote
6. Prediction: invoke model → get score + confidence
7. Feature store: ingest → query features for model
8. MIS report generation (monthly/quarterly)
9. Export: CSV/PDF/Excel generation
10. Activation tracking: new tenant → feature usage

### Module 18: Identity, Access & Trust
**Services:** identity-service, policy-service
**Test Scenarios:**
1. User creation → RBAC role assignment
2. SAML SSO login → session creation
3. MFA setup (TOTP) → verify on login
4. WebAuthn: register device → authenticate
5. SCIM: create user from external IdP
6. API key: create → verify → rotate
7. Break-glass: emergency access → audit trail
8. ABAC policy: evaluate complex rule
9. Role-feature binding: which features per role
10. Session management: list → revoke

### Module 19: Inventory, Assets, Facilities & Fleet
**Services:** asset-service, inventory-service
**Test Scenarios:**
1. Asset registration → barcode/QR generation
2. Asset depreciation calculation → book value
3. Inventory receipt → stock movement → issue
4. Warehouse transfer → verify stock levels
5. Asset maintenance schedule → work order
6. Fleet vehicle registration → GPS tracking
7. Fleet trip logging → distance calculation
8. Condemnation: propose → approve → write-off
9. Cycle count → variance → adjustment
10. Asset insurance tracking → renewal alerts

### Module 20: GIS, Land, Location & Infrastructure
**Services:** location-service
**Test Scenarios:**
1. Geocode address → lat/lng coordinates
2. Geofence: create polygon → check point-in-polygon
3. Land record: create → mutation (ownership transfer)
4. Cadastral parcel: register with boundary polygon
5. Survey scheduling → assignment → completion
6. Boundary dispute: file → assign surveyor → resolve
7. Infrastructure asset: register bridge → inspection
8. Spatial query: within 5km radius → list nearby
9. Location hierarchy: state → district → block → village
10. Pincode lookup → jurisdiction mapping

### Module 21: Configuration, Extensibility & AI
**Services:** metadata-service, plugin-service, ml-service
**Test Scenarios:**
1. Custom entity creation (metadata schema)
2. Business rule engine: define → evaluate
3. Plugin marketplace: browse → install → enable
4. Plugin hook: register → trigger on event
5. AI model deployment → inference endpoint
6. Plugin sandbox: isolated execution
7. Plugin store: key-value storage per plugin
8. ML experiment tracking: log metrics
9. Feature flag evaluation with targeting rules
10. Custom field addition to existing entities

### Module 22: Document, Content & Evidence
**Services:** knowledge-service, estab-service
**Test Scenarios:**
1. Document upload → version tracking
2. Document search (full-text) → relevance ranking
3. Evidence attachment to case/project/audit
4. e-Sign document (DSC PKCS#7) → verify signature
5. Document retention: set policy → auto-archive
6. File noting: create → append → approve
7. Document sharing: generate secure link
8. OCR: extract text from scanned document
9. PDF generation from template
10. Document category management

### Module 23: User Experience, Mobility & Accessibility
**Services:** apps/web, apps/mobile
**Test Scenarios:**
1. Page load performance: all pages < 3s
2. Responsive layout: 1024px + 768px breakpoints
3. Keyboard navigation: Tab through all interactive elements
4. Screen reader: aria-labels present on all buttons
5. Colour contrast: WCAG AA (4.5:1 ratio)
6. Offline mode: mobile app queues writes → syncs online
7. DataTable: sort + filter + paginate + export
8. Error boundary: component crash → graceful fallback
9. Loading states: skeleton on every async operation
10. RTL layout: Hindi/Urdu text alignment

### Module 24: Case, Transaction & Task Management
**Services:** workflow-service, court-service, helpdesk-service
**Test Scenarios:**
1. Create case → assign → track lifecycle
2. Task: create → claim → complete → verify state transition
3. SLA tracking: task overdue → auto-escalate
4. Transaction log: every mutation → tamper-proof trail
5. Bulk task completion → verify all updated
6. Task forwarding: reassign to another officer
7. Task recall: withdraw after forward
8. Case merge: combine related cases
9. Priority-based task queue ordering
10. Transaction idempotency: duplicate submit → no double-write

### Module 25: Security, Privacy & Compliance
**Services:** identity-service, policy-service, admin-service
**Test Scenarios:**
1. RLS: tenant-A data NOT visible to tenant-B query
2. PII encryption: verify aadhaar/PAN stored as ciphertext
3. Secret scanner: commit with API key → CI blocks
4. ABAC: role-based + attribute-based access combined
5. Audit trail: every mutation logged with actor + timestamp
6. VAPT scan: trigger → report findings
7. SOC2 evidence: export control compliance proof
8. Data retention: expired data → soft-delete → purge job
9. Break-glass: emergency access → mandatory justification
10. Session fixation: token rotation on privilege escalation

### Module 26: Organisation, Tenancy & Master Data
**Services:** tenant-service, install-service
**Test Scenarios:**
1. Tenant onboarding: provision → seed defaults → activate
2. Org hierarchy: create dept → division → section (recursive tree)
3. Subscription: upgrade plan → adjust quotas
4. Quota enforcement: exceed limit → 429
5. Settings: set per-tenant config → verify applied
6. Master data import: bulk CSV → validate → persist
7. Master data export: generate → download
8. Cross-tenant migration: dry-run → execute → verify
9. Data reconciliation: compare source → target → report breaks
10. MSME onboarding: simplified flow for small offices

### Module 27: Government Integrations & Shared Registries
**Services:** identity-service, finance-service, billing-service
**Test Scenarios:**
1. Aadhaar eKYC: OTP init → verify → demographic data (sandbox)
2. GSTN: generate e-Invoice IRN → verify acknowledgement
3. GSTN: generate e-Way Bill → verify bill number
4. GSTN: verify GSTIN → confirm active status
5. NIC: validate PAN → verify response
6. UMANG: submit service request → track status
7. Bharat BillPay: fetch billers → fetch bill → pay bill
8. DigiLocker: authorize → pull document → verify
9. PFMS: payment batch sign → submit → status check
10. eCourts: pull case status by case number

---

## Execution Instructions for AI Agent (Claude)

### Phase 1: Environment Setup
```bash
# Start infrastructure
docker compose -p civitasone --env-file infra/.env -f infra/docker-compose.yml up -d

# Wait for services to be ready
sleep 10

# Run migrations for all services
pnpm run migrate:all

# Seed test data
node scripts/seed-test-tenants.mjs
```

### Phase 2: Test Execution Pattern
For each module:
1. Generate JWT tokens for each actor role
2. Seed module-specific test data (create parent entities first)
3. Execute happy-path scenarios (expect 200/201/202)
4. Execute validation scenarios (expect 400)
5. Execute auth scenarios (expect 401/403)
6. Execute tenant-isolation scenarios (cross-tenant = empty/404)
7. Execute error-path scenarios (expect 404/409/422)
8. Verify audit trail entries after mutations
9. Verify cache invalidation (second read reflects mutation)
10. Verify cross-service choreography (event → downstream effect)

### Phase 3: Auth Token Generation
```typescript
import { signToken } from "@civitasone/auth";
const SECRET = "test_secret_for_civitasone_32chr";

function makeToken(tenantId: string, actorId: string, roles: string[]) {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: `sess-${Date.now()}` }, SECRET);
}

// Example tokens
const alphaAdmin = makeToken("tenant-alpha-uuid", "actor-alpha-superadmin", ["super_admin"]);
const alphaFinance = makeToken("tenant-alpha-uuid", "actor-alpha-finance", ["finance_officer"]);
const betaEmployee = makeToken("tenant-beta-uuid", "actor-beta-employee", ["employee"]);
```

### Phase 4: Verification Checklist
For EACH test scenario, verify:
- [ ] HTTP status code correct
- [ ] Response body shape matches schema
- [ ] Audit event emitted (check audit-service)
- [ ] Cache invalidated (subsequent GET reflects change)
- [ ] Tenant isolation (other tenant can't see data)
- [ ] Idempotency (same request twice = same result, no duplicate)
- [ ] Correlation ID propagated through all responses

---

## Success Criteria
- **All 270 test scenarios pass** (27 modules × 10 scenarios each)
- **Zero cross-tenant data leaks** (verified with 3 tenants)
- **100% audit trail coverage** (every mutation logged)
- **< 200ms p95 response time** for all read endpoints
- **Zero unhandled 500 errors** (all errors mapped to proper HTTP codes)


---

## WORLD-CLASS ADDITIONS (10/10 Level)

### A. Edge Cases & Boundary Testing (per module, 20 additional scenarios each)

**For EVERY module, additionally test:**
1. Maximum payload size (request body at 1MB limit → 413)
2. Empty string fields where min(1) expected → 400
3. UUID format violations → 400
4. SQL injection attempt in string fields → 400 (zod blocks)
5. XSS in text fields → sanitized on output
6. Integer overflow: amount = 2^53 + 1 → rejected (bigint safety)
7. Concurrent writes to same resource → optimistic lock conflict → 409
8. Duplicate idempotency key → no double-write (consumer skips)
9. Extremely long strings (10,000 chars) → 400 or truncated
10. Null bytes in strings → 400
11. Future date where past required → 400
12. Negative amounts where positive required → 400
13. Unicode edge cases (emoji, RTL markers, zero-width chars) → accepted
14. Request without Content-Type header → 415 or 400
15. Request with invalid JSON body → 400
16. Pagination: page=0, pageSize=0, offset=-1 → 400
17. Pagination: pageSize=999 (exceeds max 200) → capped at 200
18. Sort by non-existent field → 400 or ignored
19. Filter with injection in query params → 400
20. Request body with extra unknown fields → stripped (strict schema)

### B. Data Integrity & Financial Correctness

**Finance-specific (MANDATORY for government ERP):**
1. Double-entry: every debit has matching credit (sum = 0 per voucher)
2. Money stored as bigint paise — verify no floating-point anywhere
3. Budget utilisation: spent NEVER exceeds sanctioned
4. Period-close: no entries after close date → 422
5. Bank reconciliation: statement balance = book balance after reconcile
6. GST: output tax - input tax = net liability (verify arithmetic)
7. TDS: verify percentage applied matches IT Act slabs
8. Concurrent payroll runs for same month → second one blocked (409)
9. Partial payment: verify outstanding balance updates correctly
10. Write-off: verify GL impact + approval chain enforced

**HR/Payroll-specific:**
11. Leave balance: never negative after deduction
12. Salary calculation: gross - deductions = net (to the paise)
13. Attendance: cannot mark future date
14. Overtime: verify rate multiplier (1.5x/2x) applied correctly
15. FnF: verify all pending dues included (leave encashment, gratuity)

### C. Performance & Load Testing (k6 scripts)

**Per-service performance gates:**
```
Target: 1,000 TPS sustained for 5 minutes
p50 < 50ms | p95 < 200ms | p99 < 500ms
Error rate < 0.1%
Zero 500 errors under load
```

**k6 Scenarios:**
1. Read-heavy: 80% GET / 20% POST on finance voucher list
2. Write-heavy: 100% POST on notification send (1000/min)
3. Mixed CRUD: employee lifecycle (create → update → leave → attendance)
4. Spike: 0 → 5000 RPS in 10 seconds → graceful degradation
5. Soak: 500 RPS for 30 minutes → no memory leak, no pool exhaustion

### D. Resilience & Chaos Testing

**Failure injection scenarios:**
1. Redis DOWN → reads fall through to DB (WARN logged, not 500)
2. Queue DOWN → writes return 500 with clear error (not hang)
3. DB pool exhausted (20/20 connections) → 503 with backpressure
4. Upstream service timeout (10s) → circuit breaker opens → 503
5. Outbox relay stopped → messages accumulate but don't lose
6. Network partition between services → graceful degradation
7. Clock skew (5 min) → JWT still validates within tolerance
8. Disk full → log rotation kicks in, service stays up
9. OOM kill → graceful shutdown drains in-flight, restarts clean
10. Certificate expiry → fail-closed, alert fired

### E. Compliance Proof Testing

**DPDP Act 2023:**
1. PII encryption: SELECT raw from DB → verify ciphertext (not plaintext)
2. Consent: access PII without consent flag → 403
3. Right to erasure: soft-delete → verify purge job removes after retention
4. Data portability: export user's data in machine-readable format
5. Breach notification: detect leak → log within 6 hours (CERT-In)

**GFR 2017:**
6. Every payment has sanction reference → reject orphan payment
7. Three-way match: PO + GRN + Invoice must match before bill pass
8. Maker-checker: same person cannot create AND approve
9. Budget check: overspend → 422 with clear budget exhaustion message
10. Audit trail: immutable, hash-chained, exportable for CAG audit

**GIGW 3.0:**
11. Bilingual: every page available in Hindi + English
12. Accessibility: all forms keyboard-navigable
13. Responsive: all pages render at 1024px+ without horizontal scroll
14. Performance: first contentful paint < 2s on 3G

### F. Cross-Service Choreography Verification

**End-to-end business flows (span multiple services):**

1. **Leave Flow:** hrms(apply) → workflow(approve) → hrms(deduct balance) → notification(inform employee) → audit(log)
2. **Payment Flow:** finance(sanction) → finance(bill) → procurement(3-way-match) → finance(payment) → pfms(sign) → notification(receipt)
3. **Citizen Request:** citizen(submit) → workflow(assign) → helpdesk(track) → notification(status update) → citizen(resolve)
4. **Employee Onboarding:** hrms(create) → identity(create-user) → policy(assign-role) → notification(welcome) → payroll(add-to-run)
5. **Contract Renewal:** contract(expiry-detect) → notification(alert) → hrms(renewal-decision) → contract(renew|terminate) → audit(log)
6. **Audit Para:** audit(observation) → workflow(approve-para) → notification(department-head) → legal(if-escalated) → audit(close)
7. **Project Fund Release:** grant(approve) → finance(sanction) → finance(payment) → project(utilisation) → grant(UC-submit)
8. **Visitor Security:** visitor(scan) → blacklist(match) → notification(security-alert) → audit(incident) → visitor(deny-entry)
9. **Payroll Disbursement:** payroll(run) → finance(GL-entry) → payroll(bank-file) → billing(NACH) → notification(payslip)
10. **Procurement Cycle:** procurement(indent) → workflow(approve) → procurement(tender) → procurement(PO) → inventory(GRN) → finance(bill) → finance(payment)

### G. Regression & Dependency Chain Testing

**After EACH mutation, verify downstream dependencies still work:**
1. Update employee designation → payroll still calculates correct HRA
2. Change tenant plan → quotas adjusted → new limits enforced
3. Modify workflow definition → existing running instances unaffected
4. Update template → existing scheduled notifications use OLD version
5. Deactivate user → all sessions revoked → active tasks reassigned
6. Archive department → sub-units reassigned → reports updated
7. Merge two vendors → PO history consolidated → no orphan references
8. Split a budget head → child allocations sum to parent
9. Rollback a migration → service still boots → no data loss
10. Disable a plugin → hooks stop firing → no 500 errors in host service

---

## Scoring Rubric (World-Class 10/10)

| Dimension | Weight | Criteria for 10/10 |
|-----------|--------|-------------------|
| Functional coverage | 25% | All 270 base scenarios pass |
| Edge cases & validation | 15% | All 20 boundary tests pass per module |
| Data integrity | 15% | Zero arithmetic errors, double-entry balanced |
| Performance | 15% | 1000 TPS, p95 < 200ms, 0 errors under load |
| Resilience | 10% | Graceful degradation on all 10 chaos scenarios |
| Compliance | 10% | DPDP + GFR + GIGW proofs documented |
| Choreography | 5% | All 10 end-to-end flows verified |
| Regression | 5% | All 10 dependency chains verified |

**Total scenarios: 270 (base) + 540 (edge) + 15 (finance) + 5 (k6) + 10 (chaos) + 14 (compliance) + 10 (choreography) + 10 (regression) = 874 test scenarios**

---

## Execution Command for Claude Agent

```
You are testing CivitasOne ERP. Follow this master prompt exactly.

1. Start Docker infrastructure (PostgreSQL, Redis, LocalStack, Keycloak)
2. Run all 651 migrations across 41 services
3. Seed 3 tenants with 7 actors each using signToken()
4. Execute ALL 874 scenarios in order (modules 1-27, then cross-cutting)
5. For each scenario: log HTTP method, URL, status code, response time, pass/fail
6. Report: total pass/fail, p95 latency, any tenant isolation violations
7. Flag any 500 errors as CRITICAL (these indicate unhandled exceptions)
8. Verify audit trail completeness (every write has corresponding audit event)
9. Generate final report: MODULE | PASS | FAIL | SKIP | NOTES
```

