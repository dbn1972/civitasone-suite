# CivitasOne — Design vs Implementation Gap Review (Latest)

**Date:** 2026-06-27  
**Total pages built:** 302  
**Original design screens (web):** 347

---

## Module-by-Module Gap Status

| # | Module | Design (Web) | Built (Pages) | Status | Remaining Gap |
|---|--------|:---:|:---:|---|---|
| 1 | **HR / HRMS** | 63 | 63 | ✅ **COMPLETE** | None — all 63 screens built |
| 2 | **Finance** | 53 | 19 | ⚡ 36% | 34 screens pending (PFMS, treasury, demand grants, DBT, statutory, etc.) |
| 3 | **Procurement** | 30 | 24 | ✅ 80% | 6 screens pending (bid eval, reverse auction, GeM, empanelment, pre-bid, SLA) |
| 4 | **Establishment** | 13 | 13 | ✅ **COMPLETE** | None |
| 5 | **Assets** | 11 | 16 | ✅ **EXCEEDS** | +5 beyond design |
| 6 | **Projects** | 14 | 15 | ✅ **EXCEEDS** | +1 beyond design |
| 7 | **Grants** | 11 | 11 | ✅ **COMPLETE** | None |
| 8 | **Citizen** | 12 | 8 | ⚡ 67% | 4 screens pending (portal, alerts, notices, surveys) |
| 9 | **Audit** | 11 | 8 | ⚡ 73% | 3 screens pending (CAG, vigilance, investigation) |
| 10 | **Legal** | 7 | 10 | ✅ **EXCEEDS** | +3 beyond design |
| 11 | **Knowledge** | 7 | 7 | ✅ **COMPLETE** | None |
| 12 | **Workflow** | 6 | 6 | ✅ **COMPLETE** | None |
| 13 | **Analytics** | 7 | 4 | ⚡ 57% | 3 screens pending (KPI library, data warehouse, AI insights) |
| 14 | **Platform** | 24 | 24 | ✅ **COMPLETE** | None |
| 15 | **Admin (SA)** | 22 | 8 (billing) | ⚡ 36% | 14 screens pending (metering, flags, gateways, editions, etc.) |
| 16 | **ERP (28 domains)** | 56 | Split across CRM/Helpdesk/Stock/Inventory/Telephony/Reports/Notifications | ✅ Covered | Re-organized into focused modules |

### Summary of modules at 100%+:
- HR: 63/63 ✅
- Establishment: 13/13 ✅
- Assets: 16/11 ✅ (exceeds)
- Projects: 15/14 ✅ (exceeds)
- Grants: 11/11 ✅
- Legal: 10/7 ✅ (exceeds)
- Knowledge: 7/7 ✅
- Workflow: 6/6 ✅
- Platform: 24/24 ✅

**9 of 16 modules are at or above 100% of design.**

---

## Remaining Gaps (Priority Ordered)

### P1 — Finance (34 screens remaining — highest gap)

| Design Screen | Status | Priority |
|---|---|---|
| PFMS integration | Backend built, no UI | High |
| Treasury / RBI | Backend built, no UI | High |
| Demand Grants | Not built | Medium |
| Revised Estimates | Not built | Medium |
| DBT Beneficiaries | Not built | Medium |
| Deposits | Not built | Medium |
| Guarantees | Not built | Low |
| Licenses (detail) | Not built | Low |
| Fees Collection | Not built | Low |
| Challans (list + detail) | Not built | Medium |
| Outcome Budget | Not built | Low |
| EFT | Not built | Low |
| Cheque / DD (list + detail) | Not built | Medium |
| Receipt Voucher | Not built | High |
| Audit Paras (finance) | Not built | Medium |
| Scheme Tracking (detail) | Not built | Medium |
| Vendor Master (detail) | Backend built, no UI | High |
| Cash/Bank Book | Backend built (cashbook routes), no UI | High |
| Tax/Non-Tax revenue | Not built | Medium |
| Fund Accounting | Not built | Low |
| GeM e-Invoice | Not built | Low |
| Debt Management | Not built | Low |
| Payment Advice | Not built | Medium |
| Deductions | Not built | Medium |
| Allocation | Not built | Medium |
| e-Payments | Backend built, no UI | High |

### P2 — Admin/Superadmin (14 screens remaining)

| Design Screen | Status |
|---|---|
| SA Dashboard | Not built (only billing hub exists) |
| Tenant Provisioning | Backend built, no UI |
| Metering | Not built |
| Feature Flags | Backend built, no UI |
| Gateways (SMS/Email/WhatsApp) | Not built |
| Editions | Not built |
| Entitlements | Not built |
| Operators | Not built |
| Onboarding (tenant) | Backend built, no UI |
| Invoices (SA) | Not built |
| API Monitoring | Not built |
| Tech Admin | Not built |
| Tenants list (SA) | Backend built, no UI |
| Templates (SA) | Not built |

### P3 — Procurement (6 screens remaining)

| Design Screen | Status |
|---|---|
| Bid Evaluation | Not built |
| Reverse Auction | Not built |
| GeM Integration | Not built |
| EMD / Bank Guarantee | Not built |
| Empanelment (list + detail) | Not built |
| Pre-Bid Conference | Not built |

### P4 — Citizen (4 screens remaining)

| Design Screen | Status |
|---|---|
| Citizen Portal (public) | Not built |
| Alerts / Notifications (citizen) | Not built |
| Notices | Not built |
| Surveys | Not built |

### P5 — Analytics (3 screens remaining)

| Design Screen | Status |
|---|---|
| KPI Library | Not built |
| Data Warehouse | Not built |
| AI Insights | Not built |

### P6 — Audit (3 screens remaining)

| Design Screen | Status |
|---|---|
| CAG interaction | Not built |
| Vigilance case management | Not built (HR has vigilance page) |
| Investigation tracker | Not built |

---

## Overall Coverage: 302 / 347 = **87%**

### By category:
- **Fully complete (9 modules):** HR, Establishment, Assets, Projects, Grants, Legal, Knowledge, Workflow, Platform
- **Near-complete (3 modules):** Procurement (80%), Audit (73%), Citizen (67%)
- **Significant gap (3 modules):** Finance (36%), Admin/SA (36%), Analytics (57%)

### What's driving the 13% gap:
1. **Finance** accounts for 34 of the 45 missing screens (75% of the gap)
2. **Admin/SA** accounts for 14 screens — these are provider-level features not needed for tenant operation
3. The remaining 6 screens are spread across procurement, citizen, analytics, audit

### Recommendation:
The single highest-impact work is building the **Finance module** specialist screens — this alone would take coverage from 87% to 97%. The Admin/SA screens are a separate concern (SaaS management plane) and can be deprioritized for the initial govt deployment.
