# CivitasOne HRMS — UAT Sign-Off Report (Sprint 15)

**Platform:** CivitasOne HRMS  
**Report Date:** 2026-08-15  
**Prepared by:** DevOps-Engineer + Domain-Business-Tester, Sprint 15  
**Branch:** fix/sprint-15-platform-admin-coverage  
**Coverage Gate:** ≥ 80% line coverage across all services  
**Overall Gate:** PASS

---

## Module Sign-Off Table

| Module | Screens | UX Audit | Design | Tests | Coverage | GoI Compliance | Verdict |
|--------|---------|----------|--------|-------|----------|----------------|---------|
| **HR Core** — Dashboard, Employees, Leave, Attendance, Payroll, Org Chart | 6 screens | PASS | PASS | 1,145 unit + integration | hrms-service 91.1% | WCAG 2.2 AA · GovUI 3.0 · GIGW compliant | **PASS** |
| **Recruitment** — Job Postings, Applications, Interviews, Offers | 4 screens | PASS | PASS | 312 unit + integration | hrms-service 91.1% | DPDP Act 2023 data-minimisation applied | **PASS** |
| **Training & Appraisal** — Programs, Cycles, Reviews, Feedback | 4 screens | PASS | PASS | 284 unit + integration | hrms-service 91.1% | Accessible; WCAG 2.2 AA | **PASS** |
| **Payroll Main** | 1 screen | PASS | PASS | 418 unit + integration | payroll-service 92.6% | IT Act § 43A; PF/ESI statutory compliance | **PASS** |
| **Departments / Designations / Locations** | 3 screens | PASS | PASS | 196 unit + integration | admin-service 95.9% | Accessible; WCAG 2.2 AA | **PASS** |
| **Onboarding** | 1 screen | PASS | PASS | 231 unit + integration | hrms-service 91.1% | DigiLocker integration verified | **PASS** |
| **Payroll Sub-modules** — Tax, Loans, Advances, Arrears, Statutory | 5 screens | PASS | PASS | 509 unit + integration | payroll-service 92.6% | IT Act § 192; PF/ESI/ESIC compliance | **PASS** |
| **Employee Lifecycle** — Separation, Transfers, Confirmations, Exits | 4 screens | PASS | PASS | 347 unit + integration | hrms-service 91.1% | DPDP right-to-erasure workflow present | **PASS** |
| **Performance & Development** — Goals, KPIs, IDP, 360 Feedback | 4 screens | PASS | PASS | 298 unit + integration | hrms-service 91.1% | Accessible; WCAG 2.2 AA | **PASS** |
| **Platform Admin** — Tenants, Feature Flags, Audit Logs, Webhooks, Sandbox, Integrations, Data Export, Config Artefacts, Scheduled Jobs | 9 screens | PASS | PASS | 1,186 unit + integration | admin-service 95.9% | ISO 27001 audit trail; DPDP Act data-residency enforced | **PASS** |

**Total screens tested:** 41  
**Total tests executed:** 4,926 unit + integration across 10 sprint increments  
**Services with coverage data:** 39 services (all ≥ 80%)

---

## Coverage Summary — Sprint 15 Sweep

| Service | Coverage | Status |
|---------|----------|--------|
| admin-service | 95.9% | PASS |
| hrms-service | 91.1% | PASS |
| payroll-service | 92.6% | PASS |
| inspection-service | 88.0% | PASS _(was 78.6%; fixed by sprint15-coverage.test.ts)_ |
| ai-agent-service | 95.7% | PASS |
| tenant-service | 95.4% | PASS |
| project-service | 96.4% | PASS |
| catalogue-service | 99.7% | PASS |
| revenue-service | 99.6% | PASS |
| recommendation-service | 99.6% | PASS |
| meeting-service | 93.3% | PASS |
| cdp-service | 94.4% | PASS |
| stock-service | 94.4% | PASS |
| theme-service | 92.9% | PASS |
| location-service | 91.4% | PASS |
| citizen-service | 91.2% | PASS |
| plugin-service | 91.0% | PASS |
| asset-service | 90.7% | PASS |
| ml-service | 90.5% | PASS |
| loyalty-service | 90.5% | PASS |
| policy-service | 90.3% | PASS |
| report-service | 89.2% | PASS |
| court-service | 88.9% | PASS |
| legal-service | 88.8% | PASS |
| billing-service | 88.7% | PASS |
| inventory-service | 87.8% | PASS |
| grant-service | 87.7% | PASS |
| finance-service | 87.0% | PASS |
| identity-service | 86.7% | PASS |
| works-service | 85.8% | PASS |
| install-service | 85.6% | PASS |
| procurement-service | 85.4% | PASS |
| knowledge-service | 85.3% | PASS |
| audit-service | 84.4% | PASS |
| helpdesk-service | 84.3% | PASS |
| estab-service | 83.9% | PASS |
| notification-service | 83.8% | PASS |
| contract-service | 82.0% | PASS |
| visitor-service | 81.2% | PASS |
| workflow-service | 80.4% | PASS |

**Services below 80%:** 0  
**Coverage gate (≥ 80%):** PASSED across all 39 services

---

## Sprint-by-Sprint Closure History

| Sprint | Scope | Closed |
|--------|-------|--------|
| Sprints 9–11 | HR Core, Recruitment, Training & Appraisal | PASS |
| Sprint 11 | Payroll Main, Departments / Designations / Locations | PASS |
| Sprint 12 | Onboarding, Payroll Sub-modules (Tax, Loans, Advances) | PASS |
| Sprint 13 | Payroll Sub-modules (Arrears, Statutory), Employee Lifecycle (Phase 1) | PASS |
| Sprint 14 | Employee Lifecycle (Phase 2), Performance & Development | PASS |
| **Sprint 15** | **Platform Admin, Coverage Sweep (inspection-service +9.4 pp)** | **PASS** |

---

## GoI Compliance Attestation

| Standard | Status | Notes |
|----------|--------|-------|
| WCAG 2.2 AA | PASS | Automated axe-core scan + manual keyboard/screen-reader checks on all 41 screens |
| GovUI 3.0 | PASS | Design tokens and component library aligned to National Informatics Centre spec |
| GIGW 3.0 | PASS | Government website guidelines: breadcrumbs, skip-nav, ARIA landmarks verified |
| DPDP Act 2023 | PASS | Data-minimisation, right-to-erasure, consent-management flows implemented and tested |
| IT Act § 43A / § 192 | PASS | Payroll data encryption at rest (AES-256); PF/ESI/TDS statutory deductions verified |
| ISO 27001 Audit Trail | PASS | All admin actions (tenant create/delete, feature flag changes, webhook registration) emit immutable audit events |
| RLS Tenant Isolation | PASS | Row-level security enforced at DB layer; cross-tenant data leak tests pass (rls-isolation.test.ts) |

---

## Outstanding Items / Known Limitations

| Item | Severity | Owner | Target |
|------|----------|-------|--------|
| `hrms-leave-fetch` from inspection-service returns 401 in test (HRMS circuit-breaker degrades gracefully) | Low | Platform team | Sprint 16 |
| k6 load test against Platform Admin bulk-import endpoint not yet executed | Medium | QA | Pre-production |
| Formal STQC / CERT-In penetration test report pending | Medium | Security | Pre-production |

---

## Overall Verdict

**APPROVED FOR PRODUCTION DEPLOYMENT — subject to pre-production checklist below.**

All 41 screens across 10 sprint increments have been reviewed, audited, and signed off. Coverage gate (≥ 80% line coverage) is satisfied across all 39 services. GoI compliance standards (WCAG 2.2 AA, GovUI 3.0, GIGW 3.0, DPDP Act 2023, RLS isolation) are met.

---

## Next Steps (Pre-Production Checklist)

1. **k6 Load Test** — execute the Platform Admin bulk-import and tenant-provision endpoints at 2× expected peak load (target: P99 < 800 ms, error rate < 0.1%).
2. **Penetration Test** — complete CERT-In/STQC PT against the production candidate; resolve any Critical/High findings before go-live.
3. **Operational Readiness Review** — confirm Prometheus/Grafana dashboards, PagerDuty alerts, and runbooks are in place for admin-service and hrms-service.
4. **Blue/Green Deployment** — deploy to production using blue/green strategy; validate health-check endpoints before cutting over DNS.
5. **Post-Deployment Smoke Tests** — run automated smoke suite (curl / Playwright) against production for all 10 module groups.
6. **Roll-Back Plan** — confirm DB rollback scripts for any Alembic migrations introduced in Sprints 14–15 are tested and ready.

---

_Signed off by: DevOps-Engineer + Domain-Business-Tester (Sprint 15 UAT wave)_  
_Date: 2026-08-15_  
_Branch: fix/sprint-15-platform-admin-coverage_
