# Wave 0 report

Completed 2026-10-13. All verdicts are against origin/main 9c5e9e9e9.

## Result

| | Before Wave 0 | After Wave 0 |
|---|---|---|
| Open items | 3,092 | **697** |
| Closed items | 1,560 | 3,950 (2,390 new W0 ticks) |
| Blocked or obsolete | 0 | 4 |
| Priority queue open | 219 | **30** |

The per-module table is in `w0-recount.md`. Nearly all the new ticks come from large "close all N gaps" and combined gap PRs merged after the 2026-09-29 snapshot (for example #1858-#1873, #1916, #1923-#1928 and #1943/#1944). Those PRs never ticked the ledger.

## How the ticks were proven (W0-03/04)

- **Lanes B, C and D:** each candidate was read against code on main, item by item.
- **Lanes A, E and F:** the GAP id cited in code or tests on main was used as the primary signal, with the code read alongside it.
- The "close all N" PR titles were not trusted. #1868 (revenue), #1873 (billing) and #1869 (projects) each left items open or partly done.

## W0-10 independent review

The owner chose "sample + full on high-risk".

- **Scope:** 487 ticks re-checked adversarially. That is all 91 newly ticked high-severity items, plus a 15% random sample per module (minimum 3). Evidence is in `w0-review/`.
- **Result:** 424 CONFIRMED, 61 PARTLY, 2 WRONG, an error rate of 13%.
  - The 63 failures are reopened with a `W0-10 note` that says what is missing.
  - The priority queue is re-synced both ways.
- **Owner decision:** "Re-check during each wave". The 33 modules whose sample had a miss keep their other 1,558 W0 ticks marked **PROVISIONAL**. Each module's next wave PR must re-confirm or reopen them before it merges. The 424 confirmed ticks are marked `W0-10 confirmed`. In the 29 modules whose sample was clean, the 537 W0 ticks are accepted.
- About 13% of the provisional ticks (roughly 200) are expected to reopen during the waves.

## New defects found (not covered by any ledger item)

| Area | Defect | Evidence |
|---|---|---|
| Procurement vendor registration | Bank account number, category, contact person and address are silently dropped. The web form sends `bankAccountNo`/`category`/`contactPerson`/`address`, but `createVendorBody` accepts only `bankAccount` and none of the others, and zod strips the rest. | `apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx:86-100`; `services/procurement-service/src/modules/vendor/validators.ts:11-22` |
| Revenue | Float money conversion (`Number()*100`) | `revenue/receipts/RecordReceiptForm.tsx:16-21`, `config/CreatePenaltyRuleForm`, `CreateRebateRuleForm` |
| Settings branding | A logo upload is stored as a `data:` URL in `logoUrl`, but the backend requires `z.string().url().max(2048)`, so a real logo can never be saved | `services/theme-service/src/modules/tokens/validators.ts:28` |
| Workflow tasks | The document checklist reports missing mandatory documents, but Approve is never disabled (`onState` is not wired) | `workflow/_components/TasksTable.tsx:184-188`, `TaskActions.tsx` |
| Setup wizard | The "modules" step can never complete, because nothing writes `modulesConfirmed` | `setup/progress.ts:92-110` |
| Tenant-admin IdP | The export-audit call posts to a route that does not exist | `tenant-admin/idp/IdpTable.tsx:12-24,57` |
| Plugins marketplace | Install publishes `plugin.marketplace.install`, which has no subscriber, so the install shows a false success | `services/plugin-service/src/modules/marketplace/routes.ts:21-26` |
| Works Record Progress | Retry sets the same value, so it never refetches | `works/execution/record-progress` |
| Procurement purchase orders | The blacklisted-vendor check is async-only: the POST returns 202, and the form comment claims a 422 | `po/routes.ts:38-42`, `po/consumer.ts:178`, `CreatePOForm.tsx:44` |
| Public pages | `/contact`, `/api/contact` and `/.well-known` are missing from the middleware PUBLIC list, so they may redirect anonymous users to login. Needs a live check. | `apps/web/src/middleware.ts:11` |

These need ledger items and go to the Wave 2 priority list. The vendor defect is a separate fix task.


## W0-06 service-absent re-class

Scope: all 418 items whose `### GAP-...` heading carries verdict `unverified-service-absent` (matches the INDEX.md header count of 418).

Method (read from `origin/main`, no checkout): for each item the `Service` and `Endpoint(s)` lines were parsed. The service must exist as `services/<x>-service` and a `/v1/...` route literal in that service's `src/` (non-test) must match the endpoint path. The ledger's `/api` prefix was dropped and `{id}`, `:id` and `[id]` were treated as wildcards. Aliases used: `assets-service` = `asset-service`, `grants-service` = `grant-service`.

Two match tiers: exact path (including the ledger's own wording) and **alias**. An alias match means the same route exists under a differently singular/plural or prefixed path (for example the ledger says `/v1/asset/assets`, the service serves `/v1/assets/assets`). Both tiers count as present. This is a route-existence check only: it does not prove the behaviour the item asks about, so a present item is **ready for verify** (W0-04 style source check), not closed.

Buckets:
- **present**: service and a matching route exist on main, so the item is ready for verify.
- **svc-only**: the service exists, but the ledger names no route path (for example 'none registered' or a placeholder page), so no route can be matched. These need a manual look and are not counted as present.
- **absent**: the service dir or the named route is not on main. The item stays `unverified-service-absent`.

### Totals

| Bucket | Items |
|---|---|
| present (ready for verify) | 376 |
| svc-only (service exists, no route named) | 25 |
| still absent | 17 |
| **total** | 418 |

### Per module

| Module | Total | Now present (ready for verify) | Service only | Still absent |
|---|---|---|---|---|
| admin | 34 | 25 | 4 | 5 |
| ai | 1 | 1 | 0 | 0 |
| analytics | 2 | 2 | 0 | 0 |
| assets | 22 | 21 | 1 | 0 |
| audit | 11 | 10 | 1 | 0 |
| auth | 1 | 0 | 1 | 0 |
| billing | 3 | 3 | 0 | 0 |
| catalogue | 1 | 1 | 0 | 0 |
| cdp | 8 | 8 | 0 | 0 |
| change | 4 | 3 | 1 | 0 |
| citizen | 11 | 9 | 0 | 2 |
| contact | 1 | 0 | 0 | 1 |
| contracts | 5 | 5 | 0 | 0 |
| court | 1 | 1 | 0 | 0 |
| crm | 16 | 16 | 0 | 0 |
| designer | 2 | 1 | 0 | 1 |
| documents | 2 | 2 | 0 | 0 |
| domains | 1 | 1 | 0 | 0 |
| estab | 3 | 3 | 0 | 0 |
| field | 3 | 3 | 0 | 0 |
| finance | 11 | 10 | 0 | 1 |
| fleet | 1 | 1 | 0 | 0 |
| grants | 1 | 1 | 0 | 0 |
| helpdesk | 1 | 1 | 0 | 0 |
| hr | 1 | 1 | 0 | 0 |
| identity | 1 | 0 | 0 | 1 |
| inventory | 16 | 15 | 0 | 1 |
| journeys | 4 | 4 | 0 | 0 |
| knowledge | 12 | 12 | 0 | 0 |
| legal | 10 | 10 | 0 | 0 |
| locations | 8 | 8 | 0 | 0 |
| loyalty | 2 | 2 | 0 | 0 |
| meeting | 5 | 5 | 0 | 0 |
| metadata | 2 | 2 | 0 | 0 |
| notifications | 5 | 0 | 5 | 0 |
| offline | 1 | 0 | 0 | 1 |
| payroll | 20 | 16 | 4 | 0 |
| platform-admin | 5 | 4 | 1 | 0 |
| plugins | 1 | 1 | 0 | 0 |
| policy | 3 | 3 | 0 | 0 |
| pricing | 1 | 1 | 0 | 0 |
| procurement | 43 | 42 | 1 | 0 |
| projects | 6 | 6 | 0 | 0 |
| recommendations | 4 | 4 | 0 | 0 |
| reports | 5 | 5 | 0 | 0 |
| revenue | 10 | 10 | 0 | 0 |
| settings | 1 | 1 | 0 | 0 |
| stock | 4 | 4 | 0 | 0 |
| telephony | 6 | 6 | 0 | 0 |
| tenant | 11 | 11 | 0 | 0 |
| tenant-admin | 34 | 24 | 6 | 4 |
| themes | 5 | 5 | 0 | 0 |
| visitor | 5 | 5 | 0 | 0 |
| workflow | 5 | 5 | 0 | 0 |
| works | 36 | 36 | 0 | 0 |
| **all** | 418 | 376 | 25 | 17 |

### Still absent (with reason)

- GAP-ADMIN-ENTITLEMENTS-01 (admin): route not found: /v1/admin/entitlements
- GAP-ADMIN-INVOICES-01 (admin): route not found: /v1/billing/invoices
- GAP-ADMIN-METERING-01 (admin): route not found: /v1/billing/metering
- GAP-ADMIN-OPERATORS-01 (admin): route not found: /v1/admin/operators
- GAP-ADMIN-ORG-01 (admin): route not found: /v1/admin/org-hierarchy
- GAP-CITIZEN-FEEDBACK-03 (citizen): route not found: /v1/citizen/feedback
- GAP-CITIZEN-REQUESTS-DETAIL-01 (citizen): route not found: /v1/citizen/grievances/:id/{resolve
- GAP-CONTACT-HOME-06 (contact): no backend service named
- GAP-DESIGNER-DETAIL-TEST-01 (designer): route not found: /v1/citizen/catalogue/services/:id/sandbox-test/run
- GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03 (finance): route not found: /v1/finance/bills/:id/pass, /v1/finance/bills/:id/pay
- GAP-IDENTITY-API-KEYS-03 (identity): route not found: /v1/admin/api-keys
- GAP-INVENTORY-DETAIL-02 (inventory): no backend service named
- GAP-OFFLINE-HOME-02 (offline): no backend service named
- GAP-TENANT-ADMIN-IDP-05 (tenant-admin): route not found: /v1/admin/idp/providers
- GAP-TENANT-ADMIN-MFA-05 (tenant-admin): route not found: /v1/admin/mfa/users
- GAP-TENANT-ADMIN-SSO-06 (tenant-admin): route not found: /v1/admin/sso/providers
- GAP-TENANT-ADMIN-USERS-07 (tenant-admin): route not found: /v1/admin/users

### Service only (no route to match; manual check needed)

GAP-ADMIN-BULK-SCAN-01, GAP-ADMIN-BULK-SCAN-02, GAP-ADMIN-DISCOVERY-01, GAP-ADMIN-DISCOVERY-02, GAP-ASSETS-CONDEMNATION-08, GAP-AUDIT-HOME-07, GAP-AUTH-LOGIN-06, GAP-CHANGE-COMMS-05, GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01, GAP-NOTIFICATIONS-COMPOSE-01, GAP-NOTIFICATIONS-DELIVERIES-03, GAP-NOTIFICATIONS-EXPERIMENTS-01, GAP-NOTIFICATIONS-TEMPLATES-DETAIL-02, GAP-PAYROLL-OFF-CYCLE-01, GAP-PAYROLL-RETURNS-06, GAP-PAYROLL-STATUTORY-CHALLANS-01, GAP-PAYROLL-STATUTORY-CHALLANS-06, GAP-PLATFORM-ADMIN-TENANT-CONFIG-02, GAP-PROCUREMENT-APPROVALS-ESCALATION-01, GAP-TENANT-ADMIN-NOTIFICATIONS-06, GAP-TENANT-ADMIN-NOTIFICATIONS-CHANNELS-05, GAP-TENANT-ADMIN-ROLES-06, GAP-TENANT-ADMIN-ROLES-DETAIL-06, GAP-TENANT-ADMIN-SESSIONS-06, GAP-TENANT-ADMIN-USERS-DETAIL-06

### Item ids now present (ready for verify), by module

**admin** (25): GAP-ADMIN-HOME-01, GAP-ADMIN-API-MONITORING-01, GAP-ADMIN-API-MONITORING-06, GAP-ADMIN-CONFIG-02, GAP-ADMIN-CONFIG-03, GAP-ADMIN-EDITIONS-01, GAP-ADMIN-FEATURE-FLAGS-02, GAP-ADMIN-GATEWAY-CONFIG-02, GAP-ADMIN-GATEWAY-CONFIG-03, GAP-ADMIN-GATEWAY-ROUTES-01, GAP-ADMIN-GATEWAYS-01, GAP-ADMIN-INTEGRATIONS-01, GAP-ADMIN-INVOICES-02, GAP-ADMIN-METERING-02, GAP-ADMIN-ONBOARDING-01, GAP-ADMIN-ROLE-FEATURES-01, GAP-ADMIN-ROLES-01, GAP-ADMIN-ROLES-02, GAP-ADMIN-SCHEDULED-JOBS-02, GAP-ADMIN-SETTINGS-06, GAP-ADMIN-TECH-ADMIN-01, GAP-ADMIN-TECH-ADMIN-03, GAP-ADMIN-TENANTS-01, GAP-ADMIN-TENANTS-DETAIL-02, GAP-ADMIN-USERS-02

**ai** (1): GAP-AI-GOVERNANCE-02

**analytics** (2): GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06, GAP-ANALYTICS-ML-INSIGHTS-LEADS-05

**assets** (21): GAP-ASSETS-DETAIL-10, GAP-ASSETS-BULK-IMPORT-04, GAP-ASSETS-DASHBOARD-05, GAP-ASSETS-DEPRECIATION-06, GAP-ASSETS-FIXED-ASSETS-06, GAP-ASSETS-FLEET-DEVICES-07, GAP-ASSETS-FLEET-MAINTENANCE-07, GAP-ASSETS-FLEET-VEHICLES-07, GAP-ASSETS-INSURANCE-02, GAP-ASSETS-INSURANCE-DETAIL-05, GAP-ASSETS-INSURANCE-CLAIMS-07, GAP-ASSETS-LEASES-04, GAP-ASSETS-LEASES-07, GAP-ASSETS-LIST-06, GAP-ASSETS-LOCATIONS-06, GAP-ASSETS-MAINTENANCE-04, GAP-ASSETS-MAINTENANCE-NEW-06, GAP-ASSETS-PROJECTS-09, GAP-ASSETS-REGISTER-08, GAP-ASSETS-SCAN-06, GAP-ASSETS-VERIFICATION-07

**audit** (10): GAP-AUDIT-CAG-07, GAP-AUDIT-COMPLIANCE-07, GAP-AUDIT-DASHBOARD-06, GAP-AUDIT-EXPORTS-07, GAP-AUDIT-INVESTIGATION-07, GAP-AUDIT-OBSERVATIONS-07, GAP-AUDIT-OBSERVATIONS-DETAIL-07, GAP-AUDIT-PLAN-07, GAP-AUDIT-RISK-REGISTER-07, GAP-AUDIT-VIGILANCE-07

**billing** (3): GAP-BILLING-HOME-01, GAP-BILLING-INVOICES-06, GAP-BILLING-INVOICES-DETAIL-01

**catalogue** (1): GAP-CATALOGUE-HOME-02

**cdp** (8): GAP-CDP-HOME-04, GAP-CDP-EVENTS-05, GAP-CDP-IDENTITY-04, GAP-CDP-PROFILES-06, GAP-CDP-PROFILES-DETAIL-06, GAP-CDP-SEGMENTS-05, GAP-CDP-STEWARD-01, GAP-CDP-STEWARD-06

**change** (3): GAP-CHANGE-HOME-01, GAP-CHANGE-DETAIL-06, GAP-CHANGE-CALENDAR-06

**citizen** (9): GAP-CITIZEN-APPEALS-01, GAP-CITIZEN-CERTIFICATES-01, GAP-CITIZEN-DOCUMENTS-01, GAP-CITIZEN-PAYMENTS-03, GAP-CITIZEN-PORTAL-05, GAP-CITIZEN-REQUESTS-07, GAP-CITIZEN-RTI-DETAIL-01, GAP-CITIZEN-SERVICES-SERVICEKEY-02, GAP-CITIZEN-SERVICES-SERVICEKEY-TRACK-TRACKINGNO-02

**contracts** (5): GAP-CONTRACTS-HOME-05, GAP-CONTRACTS-DETAIL-07, GAP-CONTRACTS-LIST-05, GAP-CONTRACTS-NEW-05, GAP-CONTRACTS-NEW-06

**court** (1): GAP-COURT-HOME-04

**crm** (16): GAP-CRM-ACCOUNTS-05, GAP-CRM-ASSIGNMENT-DIRECTORY-04, GAP-CRM-DEALS-DETAIL-04, GAP-CRM-DOCUMENT-TYPES-01, GAP-CRM-DOCUMENTS-05, GAP-CRM-LINKED-ACCOUNTS-01, GAP-CRM-OPPORTUNITIES-01, GAP-CRM-PIPELINES-01, GAP-CRM-PRICE-BOOKS-03, GAP-CRM-QUALIFICATION-FRAMEWORKS-02, GAP-CRM-QUALIFICATION-FRAMEWORKS-05, GAP-CRM-QUOTATIONS-05, GAP-CRM-RTI-NEW-02, GAP-CRM-SERVICE-REQUESTS-DETAIL-04, GAP-CRM-SERVICE-REQUESTS-NEW-03, GAP-CRM-VOICE-OF-CUSTOMER-04

**designer** (1): GAP-DESIGNER-DETAIL-REVIEW-01

**documents** (2): GAP-DOCUMENTS-INBOX-02, GAP-DOCUMENTS-NEW-03

**domains** (1): GAP-DOMAINS-NEW-05

**estab** (3): GAP-ESTAB-APPROVAL-MATRIX-02, GAP-ESTAB-HANDOVER-02, GAP-ESTAB-QUARTERS-03

**field** (3): GAP-FIELD-HOME-04, GAP-FIELD-ROUTES-02, GAP-FIELD-SYNC-03

**finance** (10): GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-05, GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-06, GAP-FINANCE-AUDIT-PARAS-DETAIL-05, GAP-FINANCE-BUDGET-SANCTIONS-04, GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-04, GAP-FINANCE-CHART-OF-ACCOUNTS-03, GAP-FINANCE-CHART-OF-ACCOUNTS-05, GAP-FINANCE-JOURNAL-ENTRY-06, GAP-FINANCE-PAYMENTS-04, GAP-FINANCE-REVENUE-CHALLANS-DETAIL-01

**fleet** (1): GAP-FLEET-HOME-04

**grants** (1): GAP-GRANTS-DISBURSEMENTS-DETAIL-02

**helpdesk** (1): GAP-HELPDESK-CATALOGUE-BREACHES-03

**hr** (1): GAP-HR-LOCATIONS-06

**inventory** (15): GAP-INVENTORY-HOME-05, GAP-INVENTORY-DETAIL-05, GAP-INVENTORY-BINS-04, GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02, GAP-INVENTORY-GOODS-RETURNS-04, GAP-INVENTORY-GOODS-RETURNS-DETAIL-05, GAP-INVENTORY-ISSUES-04, GAP-INVENTORY-ITEMS-04, GAP-INVENTORY-LIST-04, GAP-INVENTORY-LIST-05, GAP-INVENTORY-LOW-STOCK-04, GAP-INVENTORY-RECEIPTS-04, GAP-INVENTORY-RECONCILE-05, GAP-INVENTORY-RESERVATIONS-04, GAP-INVENTORY-SUBSTITUTES-04

**journeys** (4): GAP-JOURNEYS-ACTIVE-03, GAP-JOURNEYS-ANALYTICS-03, GAP-JOURNEYS-BUILDER-03, GAP-JOURNEYS-TEMPLATES-03

**knowledge** (12): GAP-KNOWLEDGE-HOME-04, GAP-KNOWLEDGE-ASSISTANT-06, GAP-KNOWLEDGE-DASHBOARD-05, GAP-KNOWLEDGE-DOCUMENTS-NEW-05, GAP-KNOWLEDGE-FAQS-02, GAP-KNOWLEDGE-FAQS-04, GAP-KNOWLEDGE-LIST-05, GAP-KNOWLEDGE-POLICIES-04, GAP-KNOWLEDGE-POLICIES-DETAIL-06, GAP-KNOWLEDGE-RECORDS-05, GAP-KNOWLEDGE-REPOSITORY-06, GAP-KNOWLEDGE-SEARCH-06

**legal** (10): GAP-LEGAL-HOME-01, GAP-LEGAL-CASES-DETAIL-06, GAP-LEGAL-CASES-NEW-03, GAP-LEGAL-COURT-ORDERS-NEW-01, GAP-LEGAL-DASHBOARD-06, GAP-LEGAL-HEARINGS-05, GAP-LEGAL-LIST-04, GAP-LEGAL-OPINIONS-04, GAP-LEGAL-OPINIONS-DETAIL-03, GAP-LEGAL-OPINIONS-NEW-03

**locations** (8): GAP-LOCATIONS-HOME-01, GAP-LOCATIONS-GEOFENCES-04, GAP-LOCATIONS-INFRASTRUCTURE-04, GAP-LOCATIONS-JURISDICTIONS-04, GAP-LOCATIONS-LIST-04, GAP-LOCATIONS-MAPS-03, GAP-LOCATIONS-MAPS-MONITORING-01, GAP-LOCATIONS-MAPS-MONITORING-02

**loyalty** (2): GAP-LOYALTY-HOME-03, GAP-LOYALTY-PROGRAMS-03

**meeting** (5): GAP-MEETING-HOME-02, GAP-MEETING-ADMIN-02, GAP-MEETING-MEETINGS-03, GAP-MEETING-MEETINGS-MEETINGID-03, GAP-MEETING-MEETINGS-MEETINGID-MINUTES-03

**metadata** (2): GAP-METADATA-HOME-01, GAP-METADATA-ENTITIES-03

**payroll** (16): GAP-PAYROLL-CORRECTIONS-01, GAP-PAYROLL-RETURNS-04, GAP-PAYROLL-SLIPS-DETAIL-02, GAP-PAYROLL-STATUTORY-ESI-01, GAP-PAYROLL-STATUTORY-ESI-06, GAP-PAYROLL-STATUTORY-GPF-03, GAP-PAYROLL-STATUTORY-GRATUITY-01, GAP-PAYROLL-STATUTORY-GRATUITY-02, GAP-PAYROLL-STATUTORY-GRATUITY-06, GAP-PAYROLL-STATUTORY-LWF-01, GAP-PAYROLL-STATUTORY-LWF-02, GAP-PAYROLL-STATUTORY-PERQUISITE-02, GAP-PAYROLL-STATUTORY-PF-01, GAP-PAYROLL-STATUTORY-PF-02, GAP-PAYROLL-STATUTORY-PT-01, GAP-PAYROLL-STATUTORY-PT-03

**platform-admin** (4): GAP-PLATFORM-ADMIN-HOME-01, GAP-PLATFORM-ADMIN-AUDIT-LOG-02, GAP-PLATFORM-ADMIN-ORG-CONFIG-02, GAP-PLATFORM-ADMIN-ROLES-01

**plugins** (1): GAP-PLUGINS-HOME-01

**policy** (3): GAP-POLICY-HOME-01, GAP-POLICY-BINDINGS-03, GAP-POLICY-EVALUATE-05

**pricing** (1): GAP-PRICING-HOME-04

**procurement** (42): GAP-PROCUREMENT-BID-EVALUATION-06, GAP-PROCUREMENT-CONTRACTS-05, GAP-PROCUREMENT-CONTRACTS-NEW-06, GAP-PROCUREMENT-DASHBOARD-05, GAP-PROCUREMENT-EMD-BG-06, GAP-PROCUREMENT-EMPANELMENT-05, GAP-PROCUREMENT-GEM-06, GAP-PROCUREMENT-GRN-05, GAP-PROCUREMENT-GRN-DETAIL-06, GAP-PROCUREMENT-GRN-DETAIL-SRN-05, GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-06, GAP-PROCUREMENT-GRN-NEW-06, GAP-PROCUREMENT-INDENTS-05, GAP-PROCUREMENT-INDENTS-DETAIL-05, GAP-PROCUREMENT-INDENTS-NEW-06, GAP-PROCUREMENT-ORDERS-03, GAP-PROCUREMENT-ORDERS-06, GAP-PROCUREMENT-ORDERS-DETAIL-03, GAP-PROCUREMENT-ORDERS-DETAIL-06, GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-03, GAP-PROCUREMENT-ORDERS-DETAIL-AMEND-06, GAP-PROCUREMENT-ORDERS-NEW-06, GAP-PROCUREMENT-PLANNING-06, GAP-PROCUREMENT-PLANNING-DETAIL-01, GAP-PROCUREMENT-PLANNING-DETAIL-06, GAP-PROCUREMENT-PLANNING-NEW-06, GAP-PROCUREMENT-PRE-BID-04, GAP-PROCUREMENT-PRE-BID-06, GAP-PROCUREMENT-REVERSE-AUCTION-06, GAP-PROCUREMENT-RFQ-05, GAP-PROCUREMENT-RFQ-DETAIL-06, GAP-PROCUREMENT-RFQ-NEW-03, GAP-PROCUREMENT-RFQ-NEW-06, GAP-PROCUREMENT-TENDERS-05, GAP-PROCUREMENT-TENDERS-DETAIL-06, GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-06, GAP-PROCUREMENT-TENDERS-NEW-06, GAP-PROCUREMENT-VENDORS-06, GAP-PROCUREMENT-VENDORS-DETAIL-02, GAP-PROCUREMENT-VENDORS-DETAIL-06, GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-06, GAP-PROCUREMENT-VENDORS-NEW-06

**projects** (6): GAP-PROJECTS-HOME-02, GAP-PROJECTS-BENEFICIARIES-03, GAP-PROJECTS-DELAY-ANALYSIS-03, GAP-PROJECTS-DPR-TRACKING-02, GAP-PROJECTS-NEW-03, GAP-PROJECTS-WBS-03

**recommendations** (4): GAP-RECOMMENDATIONS-FEEDBACK-04, GAP-RECOMMENDATIONS-HEALTH-04, GAP-RECOMMENDATIONS-MATRIX-04, GAP-RECOMMENDATIONS-NBA-04

**reports** (5): GAP-REPORTS-LIST-04, GAP-REPORTS-LIST-05, GAP-REPORTS-LIST-NEW-02, GAP-REPORTS-MIS-03, GAP-REPORTS-SCHEDULED-02

**revenue** (10): GAP-REVENUE-HOME-01, GAP-REVENUE-ADJUSTMENTS-01, GAP-REVENUE-ANALYTICS-04, GAP-REVENUE-ASSESSEES-03, GAP-REVENUE-BBPS-01, GAP-REVENUE-CONFIG-01, GAP-REVENUE-INSTALMENTS-03, GAP-REVENUE-RECEIPTS-01, GAP-REVENUE-RECOVERY-01, GAP-REVENUE-TRADE-LICENSES-02

**settings** (1): GAP-SETTINGS-BRANDING-03

**stock** (4): GAP-STOCK-HOME-06, GAP-STOCK-DASHBOARD-06, GAP-STOCK-LEDGER-NEW-04, GAP-STOCK-LIST-04

**telephony** (6): GAP-TELEPHONY-HOME-05, GAP-TELEPHONY-AGENTS-07, GAP-TELEPHONY-CALLS-08, GAP-TELEPHONY-DISPOSITIONS-07, GAP-TELEPHONY-LIST-04, GAP-TELEPHONY-LIST-06

**tenant** (11): GAP-TENANT-HOME-01, GAP-TENANT-CODE-LISTS-04, GAP-TENANT-DATA-MIGRATION-04, GAP-TENANT-ORG-HIERARCHY-04, GAP-TENANT-OVERVIEW-05, GAP-TENANT-PLANS-04, GAP-TENANT-POSITIONS-04, GAP-TENANT-QUOTAS-05, GAP-TENANT-SETTINGS-01, GAP-TENANT-STEWARDSHIP-04, GAP-TENANT-SUBSCRIPTIONS-04

**tenant-admin** (24): GAP-TENANT-ADMIN-HOME-06, GAP-TENANT-ADMIN-ACTIVATION-05, GAP-TENANT-ADMIN-API-KEYS-03, GAP-TENANT-ADMIN-AUDIT-06, GAP-TENANT-ADMIN-BREAKGLASS-06, GAP-TENANT-ADMIN-COMPLIANCE-02, GAP-TENANT-ADMIN-COMPLIANCE-05, GAP-TENANT-ADMIN-DATA-EXPORT-06, GAP-TENANT-ADMIN-DOMAIN-05, GAP-TENANT-ADMIN-INSTALL-05, GAP-TENANT-ADMIN-OPERATIONS-04, GAP-TENANT-ADMIN-OPERATIONS-06, GAP-TENANT-ADMIN-ORG-HIERARCHY-05, GAP-TENANT-ADMIN-ORG-TYPE-05, GAP-TENANT-ADMIN-PLANS-06, GAP-TENANT-ADMIN-PLATFORM-CONFIG-03, GAP-TENANT-ADMIN-READINESS-06, GAP-TENANT-ADMIN-SECURITY-03, GAP-TENANT-ADMIN-SETTINGS-07, GAP-TENANT-ADMIN-SIEM-06, GAP-TENANT-ADMIN-SUBSCRIPTION-03, GAP-TENANT-ADMIN-SUBSCRIPTION-06, GAP-TENANT-ADMIN-USAGE-06, GAP-TENANT-ADMIN-WEBHOOKS-05

**themes** (5): GAP-THEMES-HOME-01, GAP-THEMES-BRAND-05, GAP-THEMES-BRANDING-05, GAP-THEMES-TEMPLATES-04, GAP-THEMES-TOKENS-02

**visitor** (5): GAP-VISITOR-HOME-02, GAP-VISITOR-ADMIN-02, GAP-VISITOR-GUARD-01, GAP-VISITOR-GUARD-06, GAP-VISITOR-HOST-01

**workflow** (5): GAP-WORKFLOW-HOME-01, GAP-WORKFLOW-HOME-04, GAP-WORKFLOW-DEFINITIONS-02, GAP-WORKFLOW-DESIGNER-02, GAP-WORKFLOW-MY-TASKS-01

**works** (36): GAP-WORKS-HOME-02, GAP-WORKS-HOME-06, GAP-WORKS-APPROVALS-06, GAP-WORKS-APPROVALS-AA-DETAIL-06, GAP-WORKS-APPROVALS-NEW-05, GAP-WORKS-APPROVALS-TS-NEW-05, GAP-WORKS-APPROVALS-TS-DETAIL-06, GAP-WORKS-BILLING-05, GAP-WORKS-BILLING-WORKID-07, GAP-WORKS-BILLING-ACCOUNT-COMPILE-05, GAP-WORKS-BILLING-BILLS-NEW-05, GAP-WORKS-BILLING-MEASUREMENTS-NEW-05, GAP-WORKS-BILLING-NEW-MB-05, GAP-WORKS-BOQ-05, GAP-WORKS-BOQ-WORKID-05, GAP-WORKS-BOQ-NEW-05, GAP-WORKS-CLOSURE-05, GAP-WORKS-CONTRACTORS-06, GAP-WORKS-CONTRACTORS-DETAIL-06, GAP-WORKS-CONTRACTORS-NEW-05, GAP-WORKS-EXECUTION-06, GAP-WORKS-EXECUTION-WORKID-07, GAP-WORKS-EXECUTION-ISSUES-06, GAP-WORKS-EXECUTION-ISSUES-NEW-05, GAP-WORKS-EXECUTION-PHOTOS-NEW-05, GAP-WORKS-EXECUTION-RECORD-PROGRESS-06, GAP-WORKS-MASTERS-02, GAP-WORKS-MASTERS-08, GAP-WORKS-ORDERS-06, GAP-WORKS-PROPOSALS-06, GAP-WORKS-PROPOSALS-DETAIL-09, GAP-WORKS-PROPOSALS-NEW-06, GAP-WORKS-REPORTS-07, GAP-WORKS-TENDERS-06, GAP-WORKS-TENDERS-DETAIL-08, GAP-WORKS-TENDERS-NEW-06

### Caveats

- 25 present items matched through the alias tier (route found under a different path wording). Treat these as weaker: GAP-ADMIN-EDITIONS-01, GAP-ADMIN-GATEWAYS-01, GAP-ADMIN-TENANTS-01, GAP-ASSETS-BULK-IMPORT-04, GAP-ASSETS-DASHBOARD-05, GAP-ASSETS-DEPRECIATION-06, GAP-ASSETS-FIXED-ASSETS-06, GAP-ASSETS-INSURANCE-02, GAP-ASSETS-LEASES-04, GAP-ASSETS-LEASES-07, GAP-ASSETS-LIST-06, GAP-ASSETS-LOCATIONS-06, GAP-ASSETS-MAINTENANCE-04, GAP-ASSETS-MAINTENANCE-NEW-06, GAP-ASSETS-PROJECTS-09, GAP-ASSETS-REGISTER-08, GAP-ASSETS-SCAN-06, GAP-ASSETS-VERIFICATION-07, GAP-CITIZEN-SERVICES-SERVICEKEY-02, GAP-DOMAINS-NEW-05, GAP-MEETING-HOME-02, GAP-MEETING-ADMIN-02, GAP-MEETING-MEETINGS-03, GAP-MEETING-MEETINGS-MEETINGID-03, GAP-MEETING-MEETINGS-MEETINGID-MINUTES-03
- 7 items name several endpoints and only some were found; they are counted present but verify must check the rest: GAP-ANALYTICS-ML-INSIGHTS-LEADS-05, GAP-CHANGE-DETAIL-06, GAP-CITIZEN-REQUESTS-07, GAP-INVENTORY-LIST-05, GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-06, GAP-WORKS-EXECUTION-PHOTOS-NEW-05, GAP-WORKS-TENDERS-DETAIL-08
- Routes registered through a prefix that is not a literal `/v1/...` string would be missed and show as absent. The 17 absent items should get a quick manual grep before being treated as truly absent.
