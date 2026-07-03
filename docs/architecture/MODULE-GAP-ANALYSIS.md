# CivitasOne — Module Gap Analysis (SAP ERP Benchmark)

## Executive Summary

CivitasOne covers 33 microservices spanning government ERP functions equivalent to SAP's PS, FI, CO, MM, HR, PM modules. This analysis benchmarks completeness against SAP's functional coverage and identifies remediation priorities.

## Service Maturity Classification

### Tier 1 — Production-Ready (full CQRS, tested, integrated)
| Service | Modules | SAP Equivalent | Status |
|---------|---------|---------------|--------|
| finance-service | 25 modules | FI (GL, AP, AR, Budget) | ✅ Core flows complete. GL posting, sanctions, bills, payments, treasury, advances, UCs |
| hrms-service | 38 modules | HR (PA, PT, PD, OM, RC) | ✅ Employee lifecycle, leave, attendance, appraisals, recruitment, transfers, promotions |
| procurement-service | 16 modules | MM (Purchase, Vendor, GRN) | ✅ Indents, POs, GRN, vendor empanelment, GeM integration |
| estab-service | 18 modules | CA (eOffice integration) | ✅ File management, meetings, vehicles, compliance, RTI |
| audit-service | 9 modules | Internal Audit | ✅ Plans, observations, paras, risk register, compliance |
| identity-service | 9 modules | SAP IDM | ✅ OIDC auth, device trust, RBAC, MFA |
| workflow-service | 10 modules | SAP Workflow | ✅ Tasks, approvals, delegation, escalation |

### Tier 2 — Functional but Incomplete
| Service | Modules | Gap | SAP Equivalent |
|---------|---------|-----|---------------|
| payroll-service | 9 | Missing: 5 modules without consumers (7th CPC components, arrears, bonus) | HR-PY |
| asset-service | 8 | Missing: depreciation schedules beyond SLM, asset verification workflow | FI-AA |
| grant-service | 8 | Missing: multi-year UC reconciliation, PFMS auto-mapping | PS (Grants) |
| legal-service | 10 | Missing: court order compliance tracking, limitation diary | No SAP equivalent |
| citizen-service | 9 | Missing: Aadhaar e-KYC, DigiLocker integration, payment gateway | No SAP equivalent |
| contract-service | 2 | Only contracts + rate modules. Missing: milestones, amendments, performance bonds | MM-SRV |
| stock-service | 8 | Missing: GRN-to-stock auto-post, min/max reorder, stock taking/verification | MM-IM |
| inventory-service | 3 | Has full CQRS but minimal scope (items, movements, stores only) | MM-WM |
| admin-service | 8 | Functional but missing: backup/restore, audit log export, compliance dashboard | BASIS |
| crm-service | 6 | Missing: campaign management, customer segmentation, loyalty programs | CRM |
| helpdesk-service | 3 | Missing: knowledge base search, customer portal, chat integration | SD (Service) |
| report-service | 5 | Only 1 consumer. Missing: scheduled reports, dashboard builder, export formats | BW/BI |

### Tier 3 — Skeletal (require major development)
| Service | Modules | What Exists | What's Missing |
|---------|---------|-------------|----------------|
| **plugin-service** | 1 | Generic CRUD "items" only | Plugin registry, lifecycle (install/enable/disable), sandboxing, SDK, marketplace, hook system, versioning |
| **knowledge-service** | 1 | Documents CRUD | Records management, retention policies, full-text search, categories, version control, sharing |
| **location-service** | 1 | Locations CRUD | Geo-hierarchies (State→District→Block→GP), geo-fencing, map integration, jurisdiction mapping |
| **theme-service** | 1 | Design tokens CRUD | Theme builder UI, per-tenant branding, logo upload, CSS override system, theme marketplace |
| **tenant-service** | 1 | Onboarding only | Plan management, subscription lifecycle, resource quotas, tenant data export, cross-tenant analytics |
| **telephony-service** | 3 | Agents, calls, queues | IVR builder, call recording storage, CTI integration, voicemail, auto-attendant |
| **analytics-service** | ? | Unknown | Real-time dashboards, custom metric builder, funnel analysis, cohort analysis |
| **billing-service** | ? | Unknown | Usage metering, invoice generation, payment reconciliation, dunning, tax calculation |

## Critical Integration Gaps

### Event Islands (19/33 services don't consume cross-service events)
These services operate in isolation, breaking the reactive architecture principle:

| Island Service | Should Consume Events From |
|----------------|---------------------------|
| notification-service | ALL services (leave approved → notify employee, payment made → notify vendor) |
| analytics-service | ALL services (for real-time dashboards) |
| report-service | Finance, HR, Procurement (for scheduled MIS reports) |
| billing-service | ALL services (usage metering for SaaS billing) |
| project-service | Finance (budget), Procurement (PO), HRMS (staff allocation) |
| stock-service | Procurement (GRN accepted → stock receipt) |
| crm-service | Citizen, Helpdesk (case→contact linking) |

### Missing Event Type Definitions (packages/events)
Only 7 domains have typed event contracts. Missing contracts for 26 services means:
- No compile-time safety for inter-service messages
- No schema evolution/versioning
- No event catalog for plugin developers

## SAP Feature Comparison — What CivitasOne Lacks

### FI (Finance)
- ❌ Bank reconciliation automation (MT940/BAI2 parsing)
- ❌ Multi-currency revaluation
- ❌ Withholding tax certificates (Form 16A/16B auto-generation)
- ❌ GST return filing (GSTR-1, GSTR-3B auto-prep)
- ❌ Fund flow statements

### MM (Materials)
- ❌ Automatic PO from indent (fully automated workflow)
- ❌ Vendor rating/scoring with auto-blacklist
- ❌ Physical inventory verification workflow
- ❌ Consignment stock tracking
- ❌ Subcontracting management

### HR
- ❌ 7th CPC fixation calculator (complex pay band rules)
- ❌ NPS/PRAN management
- ❌ Tour/TA management with per-diem calculation
- ❌ Seniority list generation
- ❌ Roster/reservation management (SC/ST/OBC roster points)

### PS (Projects)
- ❌ Earned value management (CPI, SPI calculation)
- ❌ Resource leveling
- ❌ Critical path method visualization
- ❌ Automatic milestone billing

### PM (Asset Maintenance)
- ❌ Preventive maintenance scheduling (time/meter-based)
- ❌ Work order management
- ❌ Spare parts inventory integration
- ❌ Equipment breakdown analysis (MTBF/MTTR)

## Remediation Priority (Recommended Order)

### P0 — Ship Blockers
1. **Plugin SDK + lifecycle** — enables 3rd party ecosystem
2. **Notification cross-service wiring** — 40+ user-facing notifications are dead
3. **HRMS consumer completion** — 30 modules have routes but no write-path

### P1 — Enterprise Readiness
4. **Event type contracts** for all 33 services
5. **Report service scheduled generation** (MIS reports mandated by CAG)
6. **GST return preparation** (legal compliance deadline)
7. **Bank reconciliation** (daily operations blocker)

### P2 — Competitive Differentiation
8. **Knowledge base full-text search** (Meilisearch already in stack)
9. **Analytics real-time dashboards**
10. **Location geo-hierarchy** (critical for govt: State/District/Block/GP)
11. **Billing/subscription lifecycle** (for SaaS/PSU edition)

### P3 — Plugin Ecosystem
12. **Plugin SDK package** (for 3rd party developers)
13. **Theme marketplace**
14. **Telephony IVR builder**
15. **Custom report builder**
