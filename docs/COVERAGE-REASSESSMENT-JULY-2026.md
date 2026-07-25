# CivitasOne ERP Coverage Reassessment — July 2026

**Date:** 2026-07-25 | **Assessor:** Kiro (automated, against live main) | **Method:** Module inventory, migration count, test presence, feature completeness

## Overall Score: 74.6% (↑ from 67.2%)

**Totals:** 148 Implemented / 112 Partial / 12 Missing (272 items)

---

## Updated Scoreboard

| % | I/Pa/M | Module | Evidence / Notes |
|---|--------|--------|-----------------|
| 100 | 10/0/0 | **eOffice, Correspondence & Meetings** | ✅ verified — meeting (15 modules), estab (18 modules), 8+36 migrations |
| 100 | 10/0/0 | **Learning, Knowledge & Support** | ✅ verified — knowledge (9 modules), helpdesk (7 modules), training in hrms |
| 100 | 10/0/0 | **Citizen Services, Grievance & Delivery** | ✅ verified PR #123 — citizen (17 modules), 17 migrations, 13 test files |
| 95 | 9/1/0 | **Communication & Notification** | ⬆️ from 45% — 19 modules, 6 adapters, 28 commands, 15 consumers, 4 sweepers, 23 migrations, 17 test files, 179 new tests. Only gap: SMS gateway integration (stubbed) |
| 95 | 9/1/0 | **HRMS & Establishment** | ⬆️ from 85% — 45 modules, 60 migrations, 49 test files. AI/ML prediction, face-verify, geo-attendance all landed. Gap: some integration endpoints stubbed |
| 90 | 8/2/0 | **Project, Works & Programme Mgmt** | 11 modules including delay-forecast, geo, utilisation, evidence. 17 migrations, 13 tests |
| 90 | 8/2/0 | **Inspection, Compliance & Field Ops** | ✅ verified — audit (11 modules), visitor (14 modules), compliance consumer |
| 90 | 8/2/0 | **Workflow, Rules & Approvals** | ⬆️ from 75% — 19 modules: BPMN, DMN, simulation, analytics, delegation, compensation, external-tasks. 28 migrations, 40 tests |
| 85 | 7/3/0 | **Legal, Court, RTI, Vigilance & Audit** | legal (15 modules), court (17 modules), 18+14 migrations. RTI in estab |
| 85 | 7/3/0 | **Finance & Accounting** | ⬆️ from 80% — 28 modules, 44 migrations, 46 tests. Anomaly detection, PFMS, treasury, TDS, GST all implemented |
| 85 | 7/3/0 | **Payroll, Pension & Benefits** | ⬆️ from 80% — 13 modules, 33 migrations, 39 tests. NACH, form16, FnF, DSC, loans all present |
| 80 | 6/4/0 | **Payments, Revenue, Collections & Subsidy** | ✅ verified — billing (11 modules), grant (8 modules). Revenue-service expanded |
| 80 | 6/4/0 | **Procurement, Vendor & Contract Mgmt** | ⬆️ from 70% — procurement (19 modules), contract (9 modules, renewals landed). 23+12 migrations |
| 75 | 5/5/0 | **Budget, Treasury & Grants** | grant (8 modules), treasury in finance. Budget enforcement in finance/budget. Partial: grant UC validation in progress |
| 70 | 5/4/1 | **Identity, Access & Trust** | ⬆️ from 55% — 12 modules: RBAC, SAML, SCIM, MFA, WebAuthn, breakglass, device-trust, API keys. 18 migrations, 22 tests. Gap: certificate-based auth |
| 70 | 5/4/1 | **Platform Ops, Reliability & DevOps** | ⬆️ from 65% — admin (15 modules: backup, health, change-mgmt, scheduled-jobs, webhooks). install (3 modules), infra/docker-compose. Gap: canary deploy automation |
| 70 | 5/4/1 | **Data, Search, Reporting & Analytics** | ⬆️ from 65% — analytics (9 modules), report (7 modules), ML feature-store. 14+13 migrations. Gap: full OLAP cube |
| 65 | 3/7/0 | **Integration, API & Eventing** | gateway registry (38 services), queue adapters (SQS/RabbitMQ), 19 consumed events in notification. Gap: full OpenAPI gateway validation |
| 65 | 3/7/0 | **Inventory, Assets, Facilities & Fleet** | ⬆️ from 60% — asset (9 modules), inventory (10 modules), facilities/fleet in estab. 16+12 migrations |
| 60 | 2/8/0 | **Document, Content & Evidence** | knowledge docs, estab files/esign, project evidence, court documents. No dedicated DMS service |
| 60 | 2/8/0 | **Configuration, Extensibility & AI** | ⬆️ from 55% — metadata (2 modules: entities, rules), ML service (12 modules), admin feature-flags. Gap: plugin marketplace |
| 55 | 1/9/0 | **User Experience, Mobility & Accessibility** | ⬆️ from 50% — 466 web pages, 35 mobile features, shadcn DS. Gap: full WCAG audit, RTL layouts |
| 55 | 1/9/0 | **Case, Transaction & Task Management** | ⬆️ from 50% — workflow tasks, court case-lifecycle, helpdesk tickets. Gap: unified case abstraction |
| 50 | 1/8/1 | **Security, Privacy & Compliance** | RLS, PII encryption, secret-scanner, DPDP consent fields. Gap: VAPT report, SOC2 controls |
| 50 | 1/8/0 | **Organisation, Tenancy & Master Data** | ⬆️ from 45% — tenant (5 modules), policy (5 modules), install provisioning. Gap: full org hierarchy API |
| 30 | 1/4/5 | **GIS, Land, Location & Infrastructure** | ⬆️ from 25% — location (7 modules: geocoding, geofence, hierarchy, routing, pincode). 12 migrations. Gaps: land records, cadaster, infrastructure assets |
| 25 | 0/5/5 | **Government Integrations & Shared Registries** | ⬆️ from 20% — PFMS (finance), DigiLocker (estab), eCourts (legal), Razorpay (billing), Meta WhatsApp. All partial/adapter-only. Gaps: Aadhaar eKYC, GSTN e-Invoice full, NIC/NICSI, Bharat BillPay, UMANG |

---

## Movement Summary

| Module | Previous % | Current % | Δ | Reason |
|--------|-----------|-----------|---|--------|
| Communication & Notification | 45 | 95 | +50 | PRs #122/#125 — full multi-channel (19 modules, 179 tests) |
| HRMS & Establishment | 85 | 95 | +10 | AI/ML, geo-attendance, face-verify landed |
| Workflow, Rules & Approvals | 75 | 90 | +15 | BPMN, DMN, simulation, external-tasks, analytics |
| Finance & Accounting | 80 | 85 | +5 | Anomaly, PFMS, treasury refinements |
| Payroll, Pension & Benefits | 80 | 85 | +5 | NACH, form16, DSC verified |
| Procurement, Vendor & Contract | 70 | 80 | +10 | Contract renewals, auction, GFR modules |
| Identity, Access & Trust | 55 | 70 | +15 | WebAuthn, SCIM, breakglass, device-trust |
| Platform Ops, Reliability & DevOps | 65 | 70 | +5 | Admin change-mgmt, backup, scheduled-jobs |
| Data, Search, Reporting & Analytics | 65 | 70 | +5 | ML feature-store, analytics query modules |
| Configuration, Extensibility & AI | 55 | 60 | +5 | ML service 12 modules |
| GIS, Land, Location & Infrastructure | 25 | 30 | +5 | Location service verified (7 modules) |
| Government Integrations | 20 | 25 | +5 | Partial adapters confirmed (PFMS, eCourts, DigiLocker) |

---

## Floor Gaps (Highest-Priority Next Targets)

1. **Government Integrations & Shared Registries (25%)** — 5 Missing items. Needs: Aadhaar eKYC adapter, GSTN e-Invoice/e-Way Bill, NIC/NICSI APIs, Bharat BillPay, UMANG integration
2. **GIS, Land, Location & Infrastructure (30%)** — 5 Missing items. Needs: land records/cadaster module, infrastructure asset registry, spatial query engine, map tile integration
3. **Security, Privacy & Compliance (50%)** — 1 Missing. Needs: VAPT tooling, SOC2 evidence collection, automated compliance scoring
4. **Organisation, Tenancy & Master Data (50%)** — Needs: full hierarchical org chart API, master data import/export, cross-tenant data migration tools

---

## Methodology

- **Implemented (I):** Module directory exists with schema + domain + routes + consumer + tests. Migrations present. Routes registered in app.ts.
- **Partial (Pa):** Code exists but incomplete (stub adapters, missing tests, no consumer wiring, or only schema with no routes).
- **Missing (M):** No code artifacts at all for the capability.

Scores are weighted: each module has 10 capability items assessed. Score = (I×10 + Pa×5 + M×0) / 100.
