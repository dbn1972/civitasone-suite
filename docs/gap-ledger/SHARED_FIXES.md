# Shared fixes — do these first

Systemic causes surfaced repeatedly by the deep pass. Each fix removes or simplifies many per-page items. Counts are items whose verified evidence/fix text mentions the pattern (approximate, keyword-matched — use as a guide).

| ID | Shared fix | Items touched | Modules |
|---|---|---|---|
| SF-01 | ModuleListTable/ModuleListPage rebuild | 249 | 24 |
| SF-02 | Error-vs-empty-vs-zero rule (RefreshErrorState / LoadErrorState) | 495 | 56 |
| SF-03 | fetchJson / mappers: empty list ≠ error | 34 | 13 |
| SF-04 | StatusPill map gaps + underscore normalisation | 318 | 50 |
| SF-05 | Masked component + read/export audit | 142 | 35 |
| SF-06 | EntityPicker / EmployeePicker / StaffPicker | 130 | 28 |
| SF-07 | formatIndianDateTime + todayIST/addDaysIST | 62 | 25 |
| SF-08 | DataTable: date cellType, server-safe render, export permission+audit, clear-filter | 247 | 39 |
| SF-09 | Shared HR/module role constants + test vs backend guards | 92 | 7 |
| SF-10 | Actor id vs hrms_employees.id (resolveEmployeeForActor) | 17 | 2 |
| SF-11 | Route-level loading.tsx / PageSkeleton with tokens | 229 | 56 |
| SF-12 | Paise parser (rupeesToMinorString) everywhere | 121 | 29 |
| SF-13 | Inline hex colours / dark mode tokens | 38 | 22 |
| SF-14 | Field/Input/Form primitives + useFormError + zod client validation | 265 | 45 |
| SF-15 | Async 202 "accepted" UX | 190 | 40 |
| SF-16 | Self-scoping on employee-readable endpoints (backend) | 19 | 3 |
| SF-17 | Thin list APIs → return names (no cross-module SQL join) | 40 | 10 |
| SF-18 | Redirect/route-existence tests + dead links | 196 | 42 |
| SF-19 | Confirm-dialog / Modal with focus trap | 371 | 46 |
| SF-20 | Sidebar / layout guards (ModuleGate + requireAnyRole) | 202 | 48 |

## SF-01 ModuleListTable/ModuleListPage rebuild

Used by ~64 list pages: shows "Couldn't load" badge AND "No records"; prints id.slice(0,8); raw status text and ISO dates; guessed columns via mapRows; no sort/filter/paging; cache key from title.

- Items touched: **249** across **24** modules (top: tenant 41, identity 21, catalogue 20, themes 17, field 15, install 15, locations 15, billing 13)
- Example ids: GAP-AI-AGENTS-01, GAP-AI-GUARDRAILS-01, GAP-BILLING-PAYMENTS-01, GAP-BILLING-PLANS-01, GAP-BILLING-PLANS-02, GAP-BILLING-SUBSCRIPTIONS-01, GAP-CATALOGUE-CATEGORIES-01, GAP-CDP-EVENTS-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-02 Error-vs-empty-vs-zero rule (RefreshErrorState / LoadErrorState)

On source==="error" render RefreshErrorState (or LoadErrorState for 403/404), pass null to StatCard ("—"), never notFound() unless status===404. Keep `status` from fetchJson.

- Items touched: **495** across **56** modules (top: hr 52, finance 43, crm 32, admin 24, payroll 21, tenant-admin 21, procurement 20, revenue 17)
- Example ids: GAP-ADMIN-AUDIT-LOG-01, GAP-ADMIN-CONFIG-01, GAP-ADMIN-DEVICES-01, GAP-ADMIN-DEVICES-02, GAP-ADMIN-GATEWAY-CONFIG-01, GAP-ADMIN-INTEGRATIONS-02, GAP-ADMIN-SA-DASHBOARD-01, GAP-ADMIN-SETTINGS-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-03 fetchJson / mappers: empty list ≠ error

~20 mappers end `mapped.length>0 ? mapped : null` so legitimately empty lists become source:"error".

- Items touched: **34** across **13** modules (top: finance 11, analytics 5, audit 4, crm 3, workflow 3, assets 1, billing 1, fleet 1)
- Example ids: GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-01, GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-01, GAP-ANALYTICS-ML-INSIGHTS-LEADS-01, GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-01, GAP-AUDIT-CAG-02, GAP-AUDIT-HOME-01, GAP-AUDIT-INVESTIGATION-01, GAP-AUDIT-VIGILANCE-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-04 StatusPill map gaps + underscore normalisation

Missing keys (in_progress, delayed, on_hold, present/absent, settled, released, disciplinary states, etc.); unknown → blue; `open` global green. Add keys, normalise underscores, allow variant/domain override.

- Items touched: **318** across **50** modules (top: hr 30, finance 29, procurement 21, tenant-admin 20, projects 18, admin 17, crm 17, payroll 17)
- Example ids: GAP-ADMIN-OPERATORS-02, GAP-ANALYTICS-QUERIES-02, GAP-BILLING-PLANS-02, GAP-CHANGE-COMMS-01, GAP-ESTAB-LIST-01, GAP-FIELD-VISITS-02, GAP-FINANCE-AUDIT-PARAS-01, GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-05 Masked component + read/export audit

No <Masked>, pii helper, or audit-on-reveal exists. Needed for PII across CDP, notifications, AI transcripts, ICC, HR banking/phone, export.

- Items touched: **142** across **35** modules (top: hr 18, payroll 14, crm 11, finance 9, tenant-admin 9, analytics 7, citizen 5, procurement 5)
- Example ids: GAP-ADMIN-SETTINGS-02, GAP-AI-CHAT-DETAIL-02, GAP-ANALYTICS-AI-INSIGHTS-01, GAP-AUDIT-INVESTIGATION-02, GAP-AUDIT-VIGILANCE-02, GAP-CDP-PROFILES-DETAIL-01, GAP-CDP-PROFILES-01, GAP-CDP-STEWARD-02
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-06 EntityPicker / EmployeePicker / StaffPicker

No picker exists; forms take raw UUIDs; only SmartCombobox (strings). Build server-search picker returning {id,label}.

- Items touched: **130** across **28** modules (top: hr 18, works 18, finance 10, estab 9, payroll 9, citizen 8, assets 7, helpdesk 5)
- Example ids: GAP-ASSETS-CONDEMNATION-01, GAP-ASSETS-FLEET-DEVICES-01, GAP-ASSETS-INSURANCE-DETAIL-01, GAP-ASSETS-REGISTER-02, GAP-CITIZEN-APPEALS-02, GAP-CITIZEN-DOCUMENTS-03, GAP-CITIZEN-INTAKE-02, GAP-CITIZEN-RTI-03
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-07 formatIndianDateTime + todayIST/addDaysIST

formatIndianDate is date-only, dd/mm/yyyy, server TZ; UTC "today" bugs; no datetime helper.

- Items touched: **62** across **25** modules (top: hr 9, finance 5, citizen 4, estab 4, field 4, notifications 4, assets 3, change 3)
- Example ids: GAP-CONTRACTS-DETAIL-02, GAP-HR-AUDIT-LOG-03, GAP-HR-CONFIRMATION-02, GAP-HR-TRANSFER-02, GAP-TENANT-ADMIN-AUDIT-01, GAP-ADMIN-DEVICES-05, GAP-AI-AGENTS-03, GAP-ASSETS-REGISTER-06
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-08 DataTable: date cellType, server-safe render, export permission+audit, clear-filter

Server pages pass `render:` functions to client DataTable (runtime error); no date cell type; CSV export un-gated/unaudited.

- Items touched: **247** across **39** modules (top: finance 41, hr 29, payroll 21, admin 17, crm 12, projects 12, procurement 10, analytics 9)
- Example ids: GAP-ADMIN-OPERATORS-02, GAP-ANALYTICS-AI-INSIGHTS-01, GAP-AUDIT-INVESTIGATION-02, GAP-AUDIT-VIGILANCE-02, GAP-BILLING-PAYMENTS-01, GAP-CDP-PROFILES-DETAIL-01, GAP-CDP-PROFILES-01, GAP-CITIZEN-REQUESTS-02
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-09 Shared HR/module role constants + test vs backend guards

Web layout/page role lists drift from backend guards (403s, unreachable roles). One constants module + matrix test.

- Items touched: **92** across **7** modules (top: hr 64, payroll 15, recruitment 6, learning 4, crm 1, finance 1, grants 1)
- Example ids: GAP-GRANTS-SCHEMES-01, GAP-HR-ADVANCES-02, GAP-HR-APAR-NEW-01, GAP-HR-ATTENDANCE-REGULARISATION-02, GAP-HR-BENEFITS-01, GAP-HR-CONFIRMATION-03, GAP-HR-DASHBOARD-01, GAP-HR-DEPARTMENTS-NEW-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-10 Actor id vs hrms_employees.id (resolveEmployeeForActor)

attendance/routes.ts (shift, WFH, overtime) compares ctx.actorId to employees.id; self-service broken. Use resolveEmployeeForActor everywhere.

- Items touched: **17** across **2** modules (top: hr 16, learning 1)
- Example ids: GAP-HR-APAR-DETAIL-01, GAP-HR-APAR-DETAIL-02, GAP-HR-ATTENDANCE-REGULARISATION-01, GAP-HR-BENEFITS-01, GAP-HR-EMPLOYEES-DETAIL-02, GAP-HR-OVERTIME-NEW-02, GAP-HR-OVERTIME-03, GAP-HR-SHIFT-REQUESTS-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-11 Route-level loading.tsx / PageSkeleton with tokens

~120 loading.tsx use bg-slate-50/hard-coded colours; `.skeleton` has no CSS; shape mismatch. One token-based skeleton on ds/Skeleton.

- Items touched: **229** across **56** modules (top: hr 38, crm 26, payroll 19, finance 12, projects 12, works 7, assets 6, cdp 6)
- Example ids: GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-02, GAP-CITIZEN-SERVICES-SERVICEKEY-01, GAP-CRM-AGENT-WORKLOAD-01, GAP-ESTAB-DFA-01, GAP-HR-DISCIPLINARY-DETAIL-02, GAP-KNOWLEDGE-LIST-01, GAP-LEARNING-TRAINING-PLANS-01, GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-02
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-12 Paise parser (rupeesToMinorString) everywhere

Math.round(x*100) / float money; three paise formatters; use lib/money.ts + formatMoney.

- Items touched: **121** across **29** modules (top: payroll 16, finance 12, works 11, analytics 10, assets 10, hr 9, crm 6, grants 6)
- Example ids: GAP-ASSETS-BULK-IMPORT-02, GAP-BILLING-GSTN-02, GAP-CONTRACTS-DETAIL-02, GAP-COURT-CASES-CASEID-02, GAP-CRM-RTI-NEW-01, GAP-DASHBOARD-HOME-02, GAP-DESIGNER-DETAIL-B5-02, GAP-FINANCE-BUDGET-FORMULATION-NEW-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-13 Inline hex colours / dark mode tokens

Hard-coded #fff/#b91c1c banners break .dark; add Alert/Banner component and use tokens.

- Items touched: **38** across **22** modules (top: tenant-admin 5, procurement 4, admin 3, ai 3, crm 3, estab 2, knowledge 2, notifications 2)
- Example ids: GAP-PROCUREMENT-VENDORS-DETAIL-SCORECARD-02, GAP-ADMIN-CONFIG-05, GAP-DOMAINS-NEW-04, GAP-GRANTS-APPLICATIONS-04, GAP-HELPDESK-INTERNAL-NEW-03, GAP-NOTIFICATIONS-HOME-02, GAP-OFFLINE-HOME-03, GAP-PROCUREMENT-VENDORS-NEW-04
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.
- W1 SF-13c (#2031): remaining finance dirs (expenditure, accounting, audit-paras, dashboard, fiscal-years, period-close, opening-balances, reconciliation, recurring-entries; 42 files) moved onto Alert/tone/tokens; guard widened; --chart-* got .dark values. Finance now has no quoted hex. No finance ledger item newly closed; none carried a PROVISIONAL tick.


## SF-14 Field/Input/Form primitives + useFormError + zod client validation

No DS Field/Input; ad-hoc validation; raw res.text() errors; double submit.

- Items touched: **265** across **45** modules (top: hr 29, finance 24, estab 17, payroll 16, tenant-admin 15, citizen 14, assets 12, crm 12)
- Example ids: GAP-ADMIN-INTEGRATIONS-02, GAP-ADMIN-SETTINGS-03, GAP-ADMIN-TENANTS-DETAIL-01, GAP-ADMIN-USERS-01, GAP-AI-AGENTS-01, GAP-AI-CHAT-01, GAP-AI-COPILOT-DETAIL-01, GAP-AI-COPILOT-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-15 Async 202 "accepted" UX

Queued writes reported as done; fixed setTimeout reload; add pending state / polling / 202 convention.

- Items touched: **190** across **40** modules (top: hr 46, finance 19, payroll 15, crm 11, estab 10, works 9, recruitment 8, assets 6)
- Example ids: GAP-ASSETS-CONDEMNATION-02, GAP-ASSETS-DEPRECIATION-01, GAP-ASSETS-INSURANCE-DETAIL-01, GAP-AUTH-FORGOT-01, GAP-CITIZEN-ELIGIBILITY-02, GAP-CITIZEN-SERVICES-SERVICEKEY-APPLY-03, GAP-CRM-SERVICE-REQUESTS-NEW-01, GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-16 Self-scoping on employee-readable endpoints (backend)

leave-requests, leave-context, checkin-log, certifications, learning my-learning/dashboard, service-book pdf return others' data; move resolveLeaveReadScope to shared.

- Items touched: **19** across **3** modules (top: hr 12, learning 6, identity 1)
- Example ids: GAP-HR-CERTIFICATIONS-02, GAP-HR-CHECKIN-LOG-02, GAP-HR-EMPLOYEES-DETAIL-02, GAP-HR-LEAVE-APPLY-02, GAP-HR-LEAVE-BALANCE-01, GAP-HR-LEAVE-02, GAP-HR-SHIFT-REQUESTS-01, GAP-HR-TRAVEL-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-17 Thin list APIs → return names (no cross-module SQL join)

List endpoints return ids only; add in-process name resolution / typed response zod schemas.

- Items touched: **40** across **10** modules (top: hr 11, payroll 9, estab 7, analytics 5, crm 2, inventory 2, admin 1, helpdesk 1)
- Example ids: GAP-ADMIN-DEVICES-01, GAP-CRM-ONBOARDING-01, GAP-ESTAB-HANDOVER-01, GAP-ESTAB-OPERATORS-01, GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-03, GAP-ESTAB-QUARTERS-DETAIL-02, GAP-HELPDESK-CATALOGUE-BREACHES-01, GAP-HR-ADVANCES-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-18 Redirect/route-existence tests + dead links

rowLinkPrefix / buildApprovalLink / tiles point at 404 routes; add a route-existence unit test.

- Items touched: **196** across **42** modules (top: finance 21, hr 19, payroll 14, citizen 9, crm 9, works 9, grants 8, analytics 7)
- Example ids: GAP-ADMIN-TENANTS-DETAIL-01, GAP-AI-CHAT-DETAIL-03, GAP-AI-COPILOT-DETAIL-01, GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-02, GAP-ANALYTICS-ML-INSIGHTS-INVENTORY-02, GAP-ANALYTICS-ML-INSIGHTS-PROJECTS-02, GAP-ANALYTICS-ML-INSIGHTS-SUBSCRIPTIONS-02, GAP-ASSETS-DETAIL-02
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-19 Confirm-dialog / Modal with focus trap

Irreversible actions single-click; hand-rolled modals lack focus trap; extract ds/Modal from ConfirmDialog.

- Items touched: **371** across **46** modules (top: hr 44, payroll 33, crm 32, tenant-admin 27, assets 23, finance 20, admin 19, works 19)
- Example ids: GAP-ADMIN-CONFIG-01, GAP-ADMIN-FEATURE-FLAGS-01, GAP-ADMIN-SCHEDULED-JOBS-01, GAP-ADMIN-SETTINGS-01, GAP-ADMIN-SETTINGS-03, GAP-ADMIN-USERS-01, GAP-AI-CHAT-DETAIL-01, GAP-ASSETS-BULK-IMPORT-01
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.


## SF-20 Sidebar / layout guards (ModuleGate + requireAnyRole)

Modules with no layout.tsx (plugins, learning, install, fleet, developer-portal, estab).

- Items touched: **202** across **48** modules (top: hr 30, payroll 30, crm 20, grants 11, tenant-admin 10, admin 8, finance 8, identity 7)
- Example ids: GAP-ADMIN-CONFIG-01, GAP-ADMIN-DEVICES-01, GAP-ADMIN-SETTINGS-02, GAP-AI-CHAT-DETAIL-02, GAP-ANALYTICS-AI-INSIGHTS-01, GAP-AUDIT-EXPORTS-02, GAP-AUDIT-INVESTIGATION-02, GAP-AUDIT-OBSERVATIONS-DETAIL-02
- Full id list: `gaps/gaps.json` filter by evidence match, or grep this pattern in the module files.
