# Screen Contract Map

Generated: 2026-08-03T19:54:57.167Z

**Summary:** 207 WIRED | 0 MISSING | 0 MISMATCH | 443 NO_LOADER

| module | screen | loader | apiPath | upstream | route? | table? | status |
|--------|--------|--------|---------|----------|--------|--------|--------|
| admin | /admin/api-monitoring | — | — | — | — | — | — NO_LOADER |
| admin | /admin/devices | — | — | — | — | — | — NO_LOADER |
| admin | /admin/editions | — | — | — | — | — | — NO_LOADER |
| admin | /admin/entitlements | — | — | — | — | — | — NO_LOADER |
| admin | /admin/feature-flags | — | — | — | — | — | — NO_LOADER |
| admin | /admin/gateway-config | — | — | — | — | — | — NO_LOADER |
| admin | /admin/gateway-routes | — | — | — | — | — | — NO_LOADER |
| admin | /admin/gateways | — | — | — | — | — | — NO_LOADER |
| admin | /admin/integrations | — | — | — | — | — | — NO_LOADER |
| admin | /admin/invoices | — | — | — | — | — | — NO_LOADER |
| admin | /admin/metering | — | — | — | — | — | — NO_LOADER |
| admin | /admin/onboarding | — | — | — | — | — | — NO_LOADER |
| admin | /admin/operators | — | — | — | — | — | — NO_LOADER |
| admin | /admin | — | — | — | — | — | — NO_LOADER |
| admin | /admin/role-features | — | — | — | — | — | — NO_LOADER |
| admin | /admin/sa-dashboard | — | — | — | — | — | — NO_LOADER |
| admin | /admin/scheduled-jobs | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tech-admin | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tenant-provision | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tenants/[id] | getAdminTenantDetail | /api/v1/admin/tenants/:param | admin → /v1/admin/tenants/:param | ✓ `/v1/admin/tenants/:id` | ✓ | ✅ WIRED |
| admin | /admin/tenants/[id] | getAdminTenantModules | /api/v1/admin/tenants/:param/config | admin → /v1/admin/tenants/:param/config | ✓ `/v1/admin/tenants/:id/config` | ✓ | ✅ WIRED |
| admin | /admin/tenants | — | — | — | — | — | — NO_LOADER |
| ai | /ai/agents | — | — | — | — | — | — NO_LOADER |
| ai | /ai/chat | — | — | — | — | — | — NO_LOADER |
| ai | /ai/copilot | — | — | — | — | — | — NO_LOADER |
| ai | /ai/governance | — | — | — | — | — | — NO_LOADER |
| ai | /ai/guardrails | — | — | — | — | — | — NO_LOADER |
| ai | /ai | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ai-insights | getAnalyticsAiInsights | /api/v1/analytics/ai-insights | analytics → /v1/analytics/ai-insights | ✓ `/v1/analytics/ai-insights` | ✓ | ✅ WIRED |
| analytics | /analytics/dashboards | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/data-warehouse | getAnalyticsDataWarehouse | /api/v1/analytics/data-warehouse | analytics → /v1/analytics/data-warehouse | ✓ `/v1/analytics/data-warehouse` | ✓ | ✅ WIRED |
| analytics | /analytics/kpi | getAnalyticsKpis | /api/v1/analytics/kpis | analytics → /v1/analytics/kpis | ✓ `/v1/analytics/kpis` | ✓ | ✅ WIRED |
| analytics | /analytics/list | getAnalyticsDashboards | /api/v1/analytics/dashboards | analytics → /v1/analytics/dashboards | ✓ `/v1/analytics/dashboards` | ✓ | ✅ WIRED |
| analytics | /analytics/ml-insights/anomalies | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights/inventory | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights/leads | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights/projects | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights/subscriptions | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ml-insights/tickets | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/queries | — | — | — | — | — | — NO_LOADER |
| approvals | /approvals | — | — | — | — | — | — NO_LOADER |
| assets | /assets/[id] | getAssetById | /api/v1/asset/assets/:param | asset → /v1/assets/assets/:param | ✓ `/v1/assets/assets/:id` | ✓ | ✅ WIRED |
| assets | /assets/bulk-import | — | — | — | — | — | — NO_LOADER |
| assets | /assets/condemnation | — | — | — | — | — | — NO_LOADER |
| assets | /assets/dashboard | getAssetDashboard | /api/v1/asset/dashboard | asset → /v1/assets/dashboard | ✓ `/v1/assets/dashboard` | ✓ | ✅ WIRED |
| assets | /assets/depreciation | — | — | — | — | — | — NO_LOADER |
| assets | /assets/fixed-assets | getFixedAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/fleet/devices | — | — | — | — | — | — NO_LOADER |
| assets | /assets/fleet/maintenance | — | — | — | — | — | — NO_LOADER |
| assets | /assets/fleet | — | — | — | — | — | — NO_LOADER |
| assets | /assets/fleet/vehicles | — | — | — | — | — | — NO_LOADER |
| assets | /assets/infra | getInfraAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/insurance/[id] | — | — | — | — | — | — NO_LOADER |
| assets | /assets/insurance/claims | — | — | — | — | — | — NO_LOADER |
| assets | /assets/insurance | — | — | — | — | — | — NO_LOADER |
| assets | /assets/leases | — | — | — | — | — | — NO_LOADER |
| assets | /assets/list | getAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/locations | — | — | — | — | — | — NO_LOADER |
| assets | /assets/maintenance/new | — | — | — | — | — | — NO_LOADER |
| assets | /assets/maintenance | getAssetMaintenance | /api/v1/asset/maintenance | asset → /v1/assets/maintenance | ✓ `/v1/assets/maintenance` | ✓ | ✅ WIRED |
| assets | /assets | — | — | — | — | — | — NO_LOADER |
| assets | /assets/projects | — | — | — | — | — | — NO_LOADER |
| assets | /assets/register | — | — | — | — | — | — NO_LOADER |
| assets | /assets/scan | — | — | — | — | — | — NO_LOADER |
| assets | /assets/verification | — | — | — | — | — | — NO_LOADER |
| audit | /audit/cag | getCagParas | /api/v1/audit/paras | audit → /v1/audit/paras | ✓ `/v1/audit/paras` | ✓ | ✅ WIRED |
| audit | /audit/compliance | getAuditCompliance | /api/v1/audit/compliance | audit → /v1/audit/compliance | ✓ `/v1/audit/compliance` | ✓ | ✅ WIRED |
| audit | /audit/dashboard | getAuditDashboard | /api/v1/audit/dashboard | audit → /v1/audit/dashboard | ✓ `/v1/audit/dashboard` | ✓ | ✅ WIRED |
| audit | /audit/exports | getAuditExports | /api/v1/audit/exports | audit → /v1/audit/exports | ✓ `/v1/audit/exports` | ✓ | ✅ WIRED |
| audit | /audit/investigation | getInvestigations | /api/v1/audit/investigations | audit → /v1/audit/investigations | ✓ `/v1/audit/investigations` | ✓ | ✅ WIRED |
| audit | /audit/observations/[id] | getAuditObservationById | /api/v1/audit/observations/:param | audit → /v1/audit/observations/:param | ✓ `/v1/audit/observations/:id` | ✓ | ✅ WIRED |
| audit | /audit/observations | getAuditObservations | /api/v1/audit/observations | audit → /v1/audit/observations | ✓ `/v1/audit/observations` | ✓ | ✅ WIRED |
| audit | /audit | getAuditItems | /api/audit/events | audit-events → /audit/events | ✓ `/audit/events` | ✓ | ✅ WIRED |
| audit | /audit/plan | getAuditPlan | /api/v1/audit/plan | audit → /v1/audit/plan | ✓ `/v1/audit/plan` | ✓ | ✅ WIRED |
| audit | /audit/risk-register | getRiskRegister | /api/v1/audit/risks | audit → /v1/audit/risks | ✓ `/v1/audit/risks` | ✓ | ✅ WIRED |
| audit | /audit/vigilance | getVigilanceCases | /api/v1/audit/vigilance | audit → /v1/audit/vigilance | ✓ `/v1/audit/vigilance` | ✓ | ✅ WIRED |
| billing | /billing/gstn | — | — | — | — | — | — NO_LOADER |
| billing | /billing/invoices/[id] | — | — | — | — | — | — NO_LOADER |
| billing | /billing/invoices | — | — | — | — | — | — NO_LOADER |
| billing | /billing/list | getBillingPlans | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| billing | /billing | — | — | — | — | — | — NO_LOADER |
| billing | /billing/payments | getBillingPayments | /api/v1/billing/payments | billing → /v1/billing/payments | ✓ `/v1/billing/payments` | ✓ | ✅ WIRED |
| billing | /billing/plans/[id] | — | — | — | — | — | — NO_LOADER |
| billing | /billing/plans/new | — | — | — | — | — | — NO_LOADER |
| billing | /billing/plans | getBillingPlans | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| billing | /billing/subscriptions | getBillingSubscriptions | /api/v1/billing/subscriptions | billing → /v1/billing/subscriptions | ✓ `/v1/billing/subscriptions` | ✓ | ✅ WIRED |
| catalogue | /catalogue/bundles | — | — | — | — | — | — NO_LOADER |
| catalogue | /catalogue/categories | — | — | — | — | — | — NO_LOADER |
| catalogue | /catalogue | — | — | — | — | — | — NO_LOADER |
| catalogue | /catalogue/products | — | — | — | — | — | — NO_LOADER |
| catalogue | /catalogue/rates | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp/events | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp/identity | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp/profiles | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp/segments | — | — | — | — | — | — NO_LOADER |
| cdp | /cdp/steward | — | — | — | — | — | — NO_LOADER |
| change | /change/[id] | — | — | — | — | — | — NO_LOADER |
| change | /change/calendar | — | — | — | — | — | — NO_LOADER |
| change | /change/comms | — | — | — | — | — | — NO_LOADER |
| change | /change | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/alerts | getCitizenAlerts | /api/v1/citizen/alerts | citizen → /v1/citizen/alerts | ✓ `/v1/citizen/alerts` | ✓ | ✅ WIRED |
| citizen | /citizen/appeals | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/catalogue | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/certificates | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/discovery | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/documents | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/eligibility | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/feedback | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/grievances/new | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/grievances | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/intake | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/notices | getCitizenNotices | /api/v1/citizen/notices | citizen → /v1/citizen/notices | ✓ `/v1/citizen/notices` | ✓ | ✅ WIRED |
| citizen | /citizen | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/payments | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/portal | getCitizenPortal | /api/v1/citizen/portal/metrics | citizen → /v1/citizen/portal/metrics | ✓ `/v1/citizen/portal/metrics` | ✓ | ✅ WIRED |
| citizen | /citizen/requests/[id] | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/requests | getCitizenRequests | /api/v1/citizen/requests | citizen → /v1/citizen/requests | ✓ `/v1/citizen/requests` | ✓ | ✅ WIRED |
| citizen | /citizen/rti/[id] | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/rti | getRTIApplications | /api/v1/citizen/rti | citizen → /v1/citizen/rti | ✓ `/v1/citizen/rti` | ✓ | ✅ WIRED |
| citizen | /citizen/surveys | getCitizenSurveys | /api/v1/citizen/surveys | citizen → /v1/citizen/surveys | ✓ `/v1/citizen/surveys` | ✓ | ✅ WIRED |
| contracts | /contracts/[id] | — | — | — | — | — | — NO_LOADER |
| contracts | /contracts/list | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| contracts | /contracts/new | — | — | — | — | — | — NO_LOADER |
| contracts | /contracts | — | — | — | — | — | — NO_LOADER |
| court | /court/admin | — | — | — | — | — | — NO_LOADER |
| court | /court/cases/[caseId] | — | — | — | — | — | — NO_LOADER |
| court | /court/cases | — | — | — | — | — | — NO_LOADER |
| court | /court/cause-list | — | — | — | — | — | — NO_LOADER |
| court | /court/hearings | — | — | — | — | — | — NO_LOADER |
| court | /court/orders | — | — | — | — | — | — NO_LOADER |
| court | /court | — | — | — | — | — | — NO_LOADER |
| crm | /crm/accounts/[id] | getCrmAccountAncestors | /api/v1/crm/accounts/:param/ancestors | crm → /v1/crm/accounts/:param/ancestors | ✓ `/v1/crm/accounts/:id/ancestors` | ✓ | ✅ WIRED |
| crm | /crm/accounts/[id] | getCrmAccountChildren | /api/v1/crm/accounts/:param/children | crm → /v1/crm/accounts/:param/children | ✓ `/v1/crm/accounts/:id/children` | ✓ | ✅ WIRED |
| crm | /crm/accounts/[id] | getCrmAccounts | /api/v1/crm/accounts | crm → /v1/crm/accounts | ✓ `/v1/crm/accounts` | ✓ | ✅ WIRED |
| crm | /crm/accounts | getCrmAccounts | /api/v1/crm/accounts | crm → /v1/crm/accounts | ✓ `/v1/crm/accounts` | ✓ | ✅ WIRED |
| crm | /crm/activities | getCRMActivities | /api/v1/crm/activities | crm → /v1/crm/activities | ✓ `/v1/crm/activities` | ✓ | ✅ WIRED |
| crm | /crm/contacts/[id]/edit | getContactById | /api/v1/crm/contacts/:param/detail | crm → /v1/crm/contacts/:param/detail | ✓ `/v1/crm/contacts/:id/detail` | ✓ | ✅ WIRED |
| crm | /crm/contacts/[id] | getContactById | /api/v1/crm/contacts/:param/detail | crm → /v1/crm/contacts/:param/detail | ✓ `/v1/crm/contacts/:id/detail` | ✓ | ✅ WIRED |
| crm | /crm/contacts/import | — | — | — | — | — | — NO_LOADER |
| crm | /crm/contacts/new | — | — | — | — | — | — NO_LOADER |
| crm | /crm/contacts | — | — | — | — | — | — NO_LOADER |
| crm | /crm/dashboard | getCRMDashboard | /api/v1/crm/dashboard | crm → /v1/crm/dashboard | ✓ `/v1/crm/dashboard` | ✓ | ✅ WIRED |
| crm | /crm/deals/[id] | getDealById | /api/v1/crm/deals/:param | crm → /v1/crm/deals/:param | ✓ `/v1/crm/deals/:id` | ✓ | ✅ WIRED |
| crm | /crm/deals/new | — | — | — | — | — | — NO_LOADER |
| crm | /crm/deals | getDeals | /api/v1/crm/deals | crm → /v1/crm/deals | ✓ `/v1/crm/deals` | ✓ | ✅ WIRED |
| crm | /crm/forecast | getCrmForecast | /api/v1/crm/forecast | crm → /v1/crm/forecast | ✓ `/v1/crm/forecast` | ✓ | ✅ WIRED |
| crm | /crm/forecast | getPipelines | /api/v1/crm/pipelines | crm → /v1/crm/pipelines | ✓ `/v1/crm/pipelines` | ✓ | ✅ WIRED |
| crm | /crm/health/[accountId] | getAccountHealthBreakdown | /api/v1/recommendations/health/:param/breakdown | recommendations → /v1/recommendations/health/:param/breakdown | ✓ `/v1/recommendations/health/:accountId/breakdown` | ✓ | ✅ WIRED |
| crm | /crm/health | getAccountHealthWatchlist | /api/v1/recommendations/health/at-risk | recommendations → /v1/recommendations/health/at-risk | ✓ `/v1/recommendations/health/:accountId` | ✓ | ✅ WIRED |
| crm | /crm/health | getCrmAccounts | /api/v1/crm/accounts | crm → /v1/crm/accounts | ✓ `/v1/crm/accounts` | ✓ | ✅ WIRED |
| crm | /crm | — | — | — | — | — | — NO_LOADER |
| crm | /crm/pipeline | getPipelines | /api/v1/crm/pipelines | crm → /v1/crm/pipelines | ✓ `/v1/crm/pipelines` | ✓ | ✅ WIRED |
| crm | /crm/pipeline | getPipelineDeals | /api/v1/crm/deals | crm → /v1/crm/deals | ✓ `/v1/crm/deals` | ✓ | ✅ WIRED |
| dashboard | /dashboard | — | — | — | — | — | — NO_LOADER |
| developer-portal | /developer-portal | getAPIKeys | /api/v1/admin/api-keys | admin → /v1/admin/api-keys | ✓ `/v1/admin/api-keys` | ✓ | ✅ WIRED |
| estab | /estab/approval-matrix | — | — | — | — | — | — NO_LOADER |
| estab | /estab/approvals | — | — | — | — | — | — NO_LOADER |
| estab | /estab/compliance | getEstabCompliance | /api/v1/estab/compliance | estab → /v1/estab/compliance | ✓ `/v1/estab/compliance` | ✓ | ✅ WIRED |
| estab | /estab/dak | — | — | — | — | — | — NO_LOADER |
| estab | /estab/dashboard | getEstabDashboard | /api/v1/estab/dashboard | estab → /v1/estab/dashboard | ✓ `/v1/estab/dashboard` | ✓ | ✅ WIRED |
| estab | /estab/dashboard | getEstabFiles | /api/v1/estab/files | estab → /v1/estab/files | ✓ `/v1/estab/files` | ✓ | ✅ WIRED |
| estab | /estab/dfa | — | — | — | — | — | — NO_LOADER |
| estab | /estab/dispatch | — | — | — | — | — | — NO_LOADER |
| estab | /estab/files/[id] | getEstabFileById | /api/v1/estab/files/:param | estab → /v1/estab/files/:param | ✓ `/v1/estab/files/:id` | ✓ | ✅ WIRED |
| estab | /estab/files/new | — | — | — | — | — | — NO_LOADER |
| estab | /estab/guesthouse | getGuesthouseBookings | /api/v1/estab/guesthouse-bookings | estab → /v1/estab/guesthouse-bookings | ✓ `/v1/estab/guesthouse-bookings` | ✓ | ✅ WIRED |
| estab | /estab/handover | — | — | — | — | — | — NO_LOADER |
| estab | /estab/inbox | getEstabFiles | /api/v1/estab/files | estab → /v1/estab/files | ✓ `/v1/estab/files` | ✓ | ✅ WIRED |
| estab | /estab/library/[id] | getLibraryBookById | /api/v1/estab/library/books/:param | estab → /v1/estab/library/books/:param | ✓ `/v1/estab/library/books/:id` | ✓ | ✅ WIRED |
| estab | /estab/library/issues | getLibraryBooks | /api/v1/estab/library/books | estab → /v1/estab/library/books | ✓ `/v1/estab/library/books` | ✓ | ✅ WIRED |
| estab | /estab/library/issues | getLibraryIssues | /api/v1/estab/library/issues | estab → /v1/estab/library/issues | ✓ `/v1/estab/library/issues` | ✓ | ✅ WIRED |
| estab | /estab/library | getLibraryBooks | /api/v1/estab/library/books | estab → /v1/estab/library/books | ✓ `/v1/estab/library/books` | ✓ | ✅ WIRED |
| estab | /estab/list | getEstabFiles | /api/v1/estab/files | estab → /v1/estab/files | ✓ `/v1/estab/files` | ✓ | ✅ WIRED |
| estab | /estab/meetings/[id] | getMeetingById | /api/v1/estab/meetings/:param | estab → /v1/estab/meetings/:param | ✓ `/v1/estab/meetings/:id` | ✓ | ✅ WIRED |
| estab | /estab/meetings | getMeetings | /api/v1/estab/meetings | estab → /v1/estab/meetings | ✓ `/v1/estab/meetings` | ✓ | ✅ WIRED |
| estab | /estab/migration | — | — | — | — | — | — NO_LOADER |
| estab | /estab/notifications | — | — | — | — | — | — NO_LOADER |
| estab | /estab/operators | — | — | — | — | — | — NO_LOADER |
| estab | /estab | — | — | — | — | — | — NO_LOADER |
| estab | /estab/quarters/[id] | — | — | — | — | — | — NO_LOADER |
| estab | /estab/quarters/allotments/[id] | — | — | — | — | — | — NO_LOADER |
| estab | /estab/quarters/allotments | — | — | — | — | — | — NO_LOADER |
| estab | /estab/quarters | — | — | — | — | — | — NO_LOADER |
| estab | /estab/vehicles | getVehicles | /api/v1/estab/vehicles | estab → /v1/estab/vehicles | ✓ `/v1/estab/vehicles` | ✓ | ✅ WIRED |
| estab | /estab/workspace | — | — | — | — | — | — NO_LOADER |
| establishment | /establishment/files | — | — | — | — | — | — NO_LOADER |
| establishment | /establishment | — | — | — | — | — | — NO_LOADER |
| field | /field/agents | — | — | — | — | — | — NO_LOADER |
| field | /field | — | — | — | — | — | — NO_LOADER |
| field | /field/routes | — | — | — | — | — | — NO_LOADER |
| field | /field/sync | — | — | — | — | — | — NO_LOADER |
| field | /field/tasks | — | — | — | — | — | — NO_LOADER |
| field | /field/visits | — | — | — | — | — | — NO_LOADER |
| finance | /finance/accounting/financial-statements | getFinancialStatements | /api/v1/finance/statements | finance → /v1/finance/statements | ✓ `/v1/finance/statements` | ✓ | ✅ WIRED |
| finance | /finance/accounting/general-ledger | getFinanceGLEntries | /api/v1/finance/journals | finance → /v1/finance/journals | ✓ `/v1/finance/journals` | ✓ | ✅ WIRED |
| finance | /finance/accounting/vouchers/new | getChartOfAccounts | /api/v1/finance/accounts | finance → /v1/finance/accounts | ✓ `/v1/finance/accounts` | ✓ | ✅ WIRED |
| finance | /finance/audit-paras/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/audit-paras | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/allocation | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/demand-grants | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/formulation/new | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/formulation | getFinanceBudgets | /api/v1/finance/budgets | finance → /v1/finance/budgets | ✓ `/v1/finance/budgets` | ✓ | ✅ WIRED |
| finance | /finance/budget/fund-accounting | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/outcome-budget | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/revised-estimates | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/sanctions/[id] | getFinanceSanctionById | /api/v1/finance/sanctions/:param | finance → /v1/finance/sanctions/:param | ✓ `/v1/finance/sanctions/:id` | ✓ | ✅ WIRED |
| finance | /finance/budget/sanctions | getFinanceSanctions | /api/v1/finance/sanctions | finance → /v1/finance/sanctions | ✓ `/v1/finance/sanctions` | ✓ | ✅ WIRED |
| finance | /finance/chart-of-accounts/new | — | — | — | — | — | — NO_LOADER |
| finance | /finance/chart-of-accounts | getChartOfAccounts | /api/v1/finance/accounts | finance → /v1/finance/accounts | ✓ `/v1/finance/accounts` | ✓ | ✅ WIRED |
| finance | /finance/config | — | — | — | — | — | — NO_LOADER |
| finance | /finance/dashboard | getFinanceDashboard | /api/v1/finance/dashboard | finance → /v1/finance/dashboard | ✓ `/v1/finance/dashboard` | ✓ | ✅ WIRED |
| finance | /finance/debt | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/advances/new | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/advances | getFinanceAdvances | /api/v1/finance/advances | finance → /v1/finance/advances | ✓ `/v1/finance/advances` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/bills/[id] | getFinanceBillById | /api/v1/finance/bills/:param | finance → /v1/finance/bills/:param | ✓ `/v1/finance/bills/:id` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/bills | getFinanceBills | /api/v1/finance/bills | finance → /v1/finance/bills | ✓ `/v1/finance/bills` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/deductions | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/guarantees | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/payment-advice | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/scheme-tracking/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/scheme-tracking | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/utilization-certificates/new | — | — | — | — | — | — NO_LOADER |
| finance | /finance/expenditure/utilization-certificates | getFinanceUCs | /api/v1/finance/utilization-certificates | finance → /v1/finance/utilization-certificates | ✓ `/v1/finance/utilization-certificates` | ✓ | ✅ WIRED |
| finance | /finance/fiscal-years | — | — | — | — | — | — NO_LOADER |
| finance | /finance/gst | — | — | — | — | — | — NO_LOADER |
| finance | /finance/journal-entry | getChartOfAccounts | /api/v1/finance/accounts | finance → /v1/finance/accounts | ✓ `/v1/finance/accounts` | ✓ | ✅ WIRED |
| finance | /finance/licenses/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/licenses | — | — | — | — | — | — NO_LOADER |
| finance | /finance/opening-balances | — | — | — | — | — | — NO_LOADER |
| finance | /finance | — | — | — | — | — | — NO_LOADER |
| finance | /finance/payments/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/payments | getPayments | /api/v1/finance/payments | finance → /v1/finance/payments | ✓ `/v1/finance/payments` | ✓ | ✅ WIRED |
| finance | /finance/period-close | — | — | — | — | — | — NO_LOADER |
| finance | /finance/pfms | — | — | — | — | — | — NO_LOADER |
| finance | /finance/reconciliation/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/reconciliation | — | — | — | — | — | — NO_LOADER |
| finance | /finance/recurring-entries | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/challans/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/challans | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/dbt | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/fees | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/receipts | — | — | — | — | — | — NO_LOADER |
| finance | /finance/revenue/tax-nontax | — | — | — | — | — | — NO_LOADER |
| finance | /finance/statutory/gem-einvoice | — | — | — | — | — | — NO_LOADER |
| finance | /finance/statutory/tds-returns | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/cash-bank | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/cheques/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/cheques | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/deposits | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/e-payments | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/eft | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/pfms | — | — | — | — | — | — NO_LOADER |
| finance | /finance/treasury/rbi | — | — | — | — | — | — NO_LOADER |
| finance | /finance/user-charges | — | — | — | — | — | — NO_LOADER |
| finance | /finance/vendors/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/vendors | getFinanceVendors | /api/v1/finance/vendors | finance → /v1/finance/vendors | ✓ `/v1/finance/vendors` | ✓ | ✅ WIRED |
| grants | /grants/[id] | getGrantById | /api/v1/grants/grants/:param | grant → /v1/grants/grants/:param | ✓ `/v1/grants/grants/:id` | ✓ | ✅ WIRED |
| grants | /grants/applications | — | — | — | — | — | — NO_LOADER |
| grants | /grants/dashboard | getGrantsDashboard | /api/v1/grants/dashboard | grant → /v1/grants/dashboard | ✓ `/v1/grants/dashboard` | ✓ | ✅ WIRED |
| grants | /grants/dashboard | getGrants | /api/v1/grants/grants | grant → /v1/grants/grants | ✓ `/v1/grants/grants` | ✓ | ✅ WIRED |
| grants | /grants/disbursements/[id] | — | — | — | — | — | — NO_LOADER |
| grants | /grants/grantees | getGrantees | /api/v1/grants/grantees | grant → /v1/grants/grantees | ✓ `/v1/grants/grantees` | ✓ | ✅ WIRED |
| grants | /grants/installments | getGrantInstallments | /api/v1/grants/installments | grant → /v1/grants/installments | ✓ `/v1/grants/installments` | ✓ | ✅ WIRED |
| grants | /grants/list | getGrants | /api/v1/grants/grants | grant → /v1/grants/grants | ✓ `/v1/grants/grants` | ✓ | ✅ WIRED |
| grants | /grants | — | — | — | — | — | — NO_LOADER |
| grants | /grants/releases | getGrantReleases | /api/v1/grants/releases | grant → /v1/grants/releases | ✓ `/v1/grants/releases` | ✓ | ✅ WIRED |
| grants | /grants/schemes/new | — | — | — | — | — | — NO_LOADER |
| grants | /grants/schemes | — | — | — | — | — | — NO_LOADER |
| grants | /grants/utilization | getGrantUtilization | /api/v1/grants/utilization-certs | grant → /v1/grants/utilization-certs | ✓ `/v1/grants/utilization-certs` | ✓ | ✅ WIRED |
| help | /help/[module] | — | — | — | — | — | — NO_LOADER |
| help | /help | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/catalogue/[id] | getCatalogueOffering | /api/v1/helpdesk/catalogue/offerings/:param | helpdesk → /v1/helpdesk/catalogue/offerings/:param | ✓ `/v1/helpdesk/catalogue/offerings/:id` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/catalogue/breaches | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/catalogue/my-requests | getMyServiceRequests | /api/v1/helpdesk/catalogue/requests | helpdesk → /v1/helpdesk/catalogue/requests | ✓ `/v1/helpdesk/catalogue/requests` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/catalogue | getCatalogueOfferings | /api/v1/helpdesk/catalogue/offerings | helpdesk → /v1/helpdesk/catalogue/offerings | ✓ `/v1/helpdesk/catalogue/offerings` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/internal/[id] | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/internal | getInternalHelpdeskTickets | /api/v1/helpdesk/tickets | helpdesk → /v1/helpdesk/tickets | ✓ `/v1/helpdesk/tickets` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/reports | getTicketAnalytics | /api/v1/citizen/tickets/analytics | citizen → /v1/citizen/tickets/analytics | ✓ `/v1/citizen/tickets/analytics` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/slas | getBreachedSLATickets | /api/v1/citizen/tickets | citizen → /v1/citizen/tickets | ✓ `/v1/citizen/tickets` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/tickets/[id] | getHelpdeskTicketById | /api/v1/citizen/tickets/:param | citizen → /v1/citizen/tickets/:param | ✓ `/v1/citizen/tickets/:id` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/tickets/new | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/tickets | getHelpdeskTicketList | /api/v1/citizen/tickets | citizen → /v1/citizen/tickets | ✓ `/v1/citizen/tickets` | ✓ | ✅ WIRED |
| hr | /hr/advances | — | — | — | — | — | — NO_LOADER |
| hr | /hr/appraisals/new | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/appraisals | getAppraisals | /api/v1/hrms/appraisals | hrms → /v1/hrms/appraisals | ✓ `/v1/hrms/appraisals` | ✓ | ✅ WIRED |
| hr | /hr/attendance/config | — | — | — | — | — | — NO_LOADER |
| hr | /hr/attendance | getAttendanceList | /api/v1/hrms/attendance | hrms → /v1/hrms/attendance | ✓ `/v1/hrms/attendance` | ✓ | ✅ WIRED |
| hr | /hr/attendance/regularisation | getAttendanceRegularisations | /api/v1/hrms/attendance/regularisations | hrms → /v1/hrms/attendance/regularisations | ✓ `/v1/hrms/attendance/regularisations` | ✓ | ✅ WIRED |
| hr | /hr/benefits | — | — | — | — | — | — NO_LOADER |
| hr | /hr/certifications | — | — | — | — | — | — NO_LOADER |
| hr | /hr/checkin-log | — | — | — | — | — | — NO_LOADER |
| hr | /hr/confirmation | — | — | — | — | — | — NO_LOADER |
| hr | /hr/contractual | — | — | — | — | — | — NO_LOADER |
| hr | /hr/dashboard | getHRDashboard | /api/v1/hrms/dashboard | hrms → /v1/hrms/dashboard | ✓ `/v1/hrms/dashboard` | ✓ | ✅ WIRED |
| hr | /hr/dashboard | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/dashboard | getJobOpenings | /api/v1/hrms/job-openings | hrms → /v1/hrms/job-openings | ✓ `/v1/hrms/job-openings` | ✓ | ✅ WIRED |
| hr | /hr/departments | — | — | — | — | — | — NO_LOADER |
| hr | /hr/deputation | — | — | — | — | — | — NO_LOADER |
| hr | /hr/designations | — | — | — | — | — | — NO_LOADER |
| hr | /hr/directory | — | — | — | — | — | — NO_LOADER |
| hr | /hr/disciplinary/[id] | — | — | — | — | — | — NO_LOADER |
| hr | /hr/employee-types | — | — | — | — | — | — NO_LOADER |
| hr | /hr/employees/[id] | getEmployeeById | /api/v1/hrms/employees/:param | hrms → /v1/hrms/employees/:param | ✓ `/v1/hrms/employees/:id` | ✓ | ✅ WIRED |
| hr | /hr/employees/import | — | — | — | — | — | — NO_LOADER |
| hr | /hr/employees | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/expenses | — | — | — | — | — | — NO_LOADER |
| hr | /hr/goals | — | — | — | — | — | — NO_LOADER |
| hr | /hr/grievance | — | — | — | — | — | — NO_LOADER |
| hr | /hr/holidays | — | — | — | — | — | — NO_LOADER |
| hr | /hr/id-cards | — | — | — | — | — | — NO_LOADER |
| hr | /hr/interns | — | — | — | — | — | — NO_LOADER |
| hr | /hr/leave/apply | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/leave/approvals | — | — | — | — | — | — NO_LOADER |
| hr | /hr/leave | getLeaveRequestDetails | /api/v1/hrms/leave-requests | hrms → /v1/hrms/leave-requests | ✓ `/v1/hrms/leave-requests` | ✓ | ✅ WIRED |
| hr | /hr/leave-policies | — | — | — | — | — | — NO_LOADER |
| hr | /hr/loans | — | — | — | — | — | — NO_LOADER |
| hr | /hr/onboarding | — | — | — | — | — | — NO_LOADER |
| hr | /hr/orgchart | getOrgChart | /api/v1/hrms/org-chart | hrms → /v1/hrms/org-chart | ✓ `/v1/hrms/org-chart` | ✓ | ✅ WIRED |
| hr | /hr/outsourced | — | — | — | — | — | — NO_LOADER |
| hr | /hr | — | — | — | — | — | — NO_LOADER |
| hr | /hr/pay-matrix | getPayMatrix | /api/v1/hrms/pay-matrix | hrms → /v1/hrms/pay-matrix | ✓ `/v1/hrms/pay-matrix` | ✓ | ✅ WIRED |
| hr | /hr/payroll/[id] | getPayrollRunById | /api/v1/payroll/runs/:param | payroll → /v1/payroll/runs/:param | ✓ `/v1/payroll/runs/:id` | ✓ | ✅ WIRED |
| hr | /hr/payroll/arrears | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/bonus | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/comparison | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/corrections | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/costing | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/ctc | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/ddos | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/disbursement | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/flex-benefits | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/fnf | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/form16 | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/gpf | getGpfStatements | /api/v1/payroll/statutory/gpf | payroll → /v1/payroll/statutory/gpf | ✓ `/v1/payroll/statutory/gpf` | ✓ | ✅ WIRED |
| hr | /hr/payroll/income-tax | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/loans | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/nps | getNpsStatements | /api/v1/payroll/statutory/nps | payroll → /v1/payroll/statutory/nps | ✓ `/v1/payroll/statutory/nps` | ✓ | ✅ WIRED |
| hr | /hr/payroll/off-cycle | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll | getPayrollRunDetails | /api/v1/payroll/runs | payroll → /v1/payroll/runs | ✓ `/v1/payroll/runs` | ✓ | ✅ WIRED |
| hr | /hr/payroll | getPayrollStructures | /api/v1/payroll/structures | payroll → /v1/payroll/structures | ✓ `/v1/payroll/structures` | ✓ | ✅ WIRED |
| hr | /hr/payroll/pay-groups | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/pensioners/new | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/pensioners | getPensioners | /api/v1/payroll/pensioners | payroll → /v1/payroll/pensioners | ✓ `/v1/payroll/pensioners` | ✓ | ✅ WIRED |
| hr | /hr/payroll/period | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/register | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/reimbursements | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/returns | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/salary-revisions | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/salary-slips/[id] | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/salary-slips | getSalarySlips | /api/v1/payroll/salary-slips | payroll → /v1/payroll/salary-slips | ✓ `/v1/payroll/salary-slips` | ✓ | ✅ WIRED |
| hr | /hr/payroll/slips/[id] | getSlipById | /api/v1/payroll/slips/:param | payroll → /v1/payroll/slips/:param | ✓ `/v1/payroll/slips/:id` | ✓ | ✅ WIRED |
| hr | /hr/payroll/statutory/challans | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/esi | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/gratuity | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/lwf | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/perquisite | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/pf | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/statutory/pt | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/structures | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/tax-config | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/tax-declaration | — | — | — | — | — | — NO_LOADER |
| hr | /hr/promotion | — | — | — | — | — | — NO_LOADER |
| hr | /hr/recruitment/[id] | — | — | — | — | — | — NO_LOADER |
| hr | /hr/recruitment/new | — | — | — | — | — | — NO_LOADER |
| hr | /hr/recruitment | — | — | — | — | — | — NO_LOADER |
| hr | /hr/recruitment/talent-pool | — | — | — | — | — | — NO_LOADER |
| hr | /hr/retirement | — | — | — | — | — | — NO_LOADER |
| hr | /hr/salary-structure | — | — | — | — | — | — NO_LOADER |
| hr | /hr/service-book | — | — | — | — | — | — NO_LOADER |
| hr | /hr/shift-requests | — | — | — | — | — | — NO_LOADER |
| hr | /hr/shifts | — | — | — | — | — | — NO_LOADER |
| hr | /hr/skills | — | — | — | — | — | — NO_LOADER |
| hr | /hr/social-feed | — | — | — | — | — | — NO_LOADER |
| hr | /hr/staffing-plan | — | — | — | — | — | — NO_LOADER |
| hr | /hr/training/feedback | — | — | — | — | — | — NO_LOADER |
| hr | /hr/training/new | — | — | — | — | — | — NO_LOADER |
| hr | /hr/training/nominations | — | — | — | — | — | — NO_LOADER |
| hr | /hr/training | getTrainingPrograms | /api/v1/hrms/training-programs | hrms → /v1/hrms/training-programs | ✓ `/v1/hrms/training-programs` | ✓ | ✅ WIRED |
| hr | /hr/transfer | — | — | — | — | — | — NO_LOADER |
| hr | /hr/travel | — | — | — | — | — | — NO_LOADER |
| hr | /hr/vigilance | — | — | — | — | — | — NO_LOADER |
| hr | /hr/wfh | — | — | — | — | — | — NO_LOADER |
| hr | /hr/work-summary | — | — | — | — | — | — NO_LOADER |
| identity | /identity/api-keys | — | — | — | — | — | — NO_LOADER |
| identity | /identity/breakglass | — | — | — | — | — | — NO_LOADER |
| identity | /identity | — | — | — | — | — | — NO_LOADER |
| identity | /identity/sessions | — | — | — | — | — | — NO_LOADER |
| identity | /identity/users | — | — | — | — | — | — NO_LOADER |
| identity | /identity/webauthn | — | — | — | — | — | — NO_LOADER |
| inspection | /inspection/assignments | — | — | — | — | — | — NO_LOADER |
| inspection | /inspection/capa | — | — | — | — | — | — NO_LOADER |
| inspection | /inspection/inspections | — | — | — | — | — | — NO_LOADER |
| inspection | /inspection | — | — | — | — | — | — NO_LOADER |
| install | /install/console | — | — | — | — | — | — NO_LOADER |
| install | /install/modules | — | — | — | — | — | — NO_LOADER |
| install | /install | getInstallSteps | /api/v1/install/steps | install → /v1/install/steps | ✓ `/v1/install/steps` | ✓ | ✅ WIRED |
| install | /install/silos | — | — | — | — | — | — NO_LOADER |
| install | /install/stages | — | — | — | — | — | — NO_LOADER |
| install | /install/steps | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/bins | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/goods-returns | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/issues | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/items | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/list | getStockItems | /api/v1/stock/items | stock → /v1/stock/items | ✓ `/v1/stock/items` | ✓ | ✅ WIRED |
| inventory | /inventory/low-stock | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/receipts | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/reconcile | getStockLedger | /api/v1/stock/ledger | stock → /v1/stock/ledger | ✓ `/v1/stock/ledger` | ✓ | ✅ WIRED |
| inventory | /inventory/reservations | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/substitutes | — | — | — | — | — | — NO_LOADER |
| journeys | /journeys/active | — | — | — | — | — | — NO_LOADER |
| journeys | /journeys/analytics | — | — | — | — | — | — NO_LOADER |
| journeys | /journeys/builder | — | — | — | — | — | — NO_LOADER |
| journeys | /journeys | — | — | — | — | — | — NO_LOADER |
| journeys | /journeys/templates | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/assistant | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/dashboard | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/documents/new | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/faqs | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/list | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/policies/[id] | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/policies | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/records | getKnowledgeRecords | /api/v1/knowledge/records | knowledge → /v1/knowledge/records | ✓ `/v1/knowledge/records` | ✓ | ✅ WIRED |
| knowledge | /knowledge/repository | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/search | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| learning | /learning/assessments | — | — | — | — | — | — NO_LOADER |
| learning | /learning/assessments/verify | — | — | — | — | — | — NO_LOADER |
| learning | /learning/calendar | — | — | — | — | — | — NO_LOADER |
| learning | /learning/competency | — | — | — | — | — | — NO_LOADER |
| learning | /learning/courses/[id] | — | — | — | — | — | — NO_LOADER |
| learning | /learning/my-learning | — | — | — | — | — | — NO_LOADER |
| learning | /learning | — | — | — | — | — | — NO_LOADER |
| legal | /legal/cases/[id] | getLegalCaseById | /api/v1/legal/cases/:param | legal → /v1/legal/cases/:param | ✓ `/v1/legal/cases/:id` | ✓ | ✅ WIRED |
| legal | /legal/cases/new | — | — | — | — | — | — NO_LOADER |
| legal | /legal/court-orders/new | getLegalCases | /api/v1/legal/cases | legal → /v1/legal/cases | ✓ `/v1/legal/cases` | ✓ | ✅ WIRED |
| legal | /legal/court-orders | getCourtOrders | /api/v1/legal/court-orders | legal → /v1/legal/court-orders | ✓ `/v1/legal/court-orders` | ✓ | ✅ WIRED |
| legal | /legal/dashboard | getLegalDashboard | /api/v1/legal/dashboard | legal → /v1/legal/dashboard | ✓ `/v1/legal/dashboard` | ✓ | ✅ WIRED |
| legal | /legal/hearings | getLegalHearings | /api/v1/legal/hearings | legal → /v1/legal/hearings | ✓ `/v1/legal/hearings` | ✓ | ✅ WIRED |
| legal | /legal/list | getLegalCases | /api/v1/legal/cases | legal → /v1/legal/cases | ✓ `/v1/legal/cases` | ✓ | ✅ WIRED |
| legal | /legal/opinions/[id] | — | — | — | — | — | — NO_LOADER |
| legal | /legal/opinions/new | — | — | — | — | — | — NO_LOADER |
| legal | /legal/opinions | getLegalOpinions | /api/v1/legal/opinions | legal → /v1/legal/opinions | ✓ `/v1/legal/opinions` | ✓ | ✅ WIRED |
| legal | /legal | — | — | — | — | — | — NO_LOADER |
| locations | /locations/geofences | — | — | — | — | — | — NO_LOADER |
| locations | /locations/infrastructure | — | — | — | — | — | — NO_LOADER |
| locations | /locations/jurisdictions | — | — | — | — | — | — NO_LOADER |
| locations | /locations/list | getLocations | /api/v1/locations | locations → /v1/locations/ | ✓ `/v1/locations` | ✓ | ✅ WIRED |
| locations | /locations/maps/monitoring | — | — | — | — | — | — NO_LOADER |
| locations | /locations/maps | — | — | — | — | — | — NO_LOADER |
| locations | /locations | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty/accruals | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty/members | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty/programs | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty/redemptions | — | — | — | — | — | — NO_LOADER |
| loyalty | /loyalty/tiers | — | — | — | — | — | — NO_LOADER |
| meeting | /meeting/admin | — | — | — | — | — | — NO_LOADER |
| meeting | /meeting/meetings/[meetingId]/minutes | — | — | — | — | — | — NO_LOADER |
| meeting | /meeting/meetings/[meetingId] | — | — | — | — | — | — NO_LOADER |
| meeting | /meeting/meetings | getMeetings | /api/v1/estab/meetings | estab → /v1/estab/meetings | ✓ `/v1/estab/meetings` | ✓ | ✅ WIRED |
| meeting | /meeting | getMeetings | /api/v1/estab/meetings | estab → /v1/estab/meetings | ✓ `/v1/estab/meetings` | ✓ | ✅ WIRED |
| metadata | /metadata/entities | — | — | — | — | — | — NO_LOADER |
| metadata | /metadata/fields | — | — | — | — | — | — NO_LOADER |
| metadata | /metadata/forms | — | — | — | — | — | — NO_LOADER |
| metadata | /metadata | — | — | — | — | — | — NO_LOADER |
| metadata | /metadata/records | — | — | — | — | — | — NO_LOADER |
| metadata | /metadata/rules | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/compose | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/deliveries/[id] | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/deliveries | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/list | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/templates/[id] | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/templates | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins/hooks | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins/installed | getPlugins | /api/v1/plugins/items | plugin → /v1/plugins/items | ✓ `/v1/plugins/items` | ✓ | ✅ WIRED |
| plugins | /plugins/marketplace | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins/registry | — | — | — | — | — | — NO_LOADER |
| policy | /policy/abac | — | — | — | — | — | — NO_LOADER |
| policy | /policy/bindings | — | — | — | — | — | — NO_LOADER |
| policy | /policy/evaluate | — | — | — | — | — | — NO_LOADER |
| policy | /policy | — | — | — | — | — | — NO_LOADER |
| policy | /policy/role-features | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/approvals/escalation | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/approvals | getProcurementApprovals | /api/v1/procurement/approvals | procurement → /v1/procurement/approvals | ✓ `/v1/procurement/approvals` | ✓ | ✅ WIRED |
| procurement | /procurement/bid-evaluation | getProcurementBidEvaluations | /api/v1/procurement/bid-evaluations | procurement → /v1/procurement/bid-evaluations | ✓ `/v1/procurement/bid-evaluations` | ✓ | ✅ WIRED |
| procurement | /procurement/contracts/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/contracts | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| procurement | /procurement/dashboard | getProcurementDashboard | /api/v1/procurement/dashboard | procurement → /v1/procurement/dashboard | ✓ `/v1/procurement/dashboard` | ✓ | ✅ WIRED |
| procurement | /procurement/emd-bg | getProcurementEMD | /api/v1/procurement/emd | procurement → /v1/procurement/emd | ✓ `/v1/procurement/emd` | ✓ | ✅ WIRED |
| procurement | /procurement/emd-bg | getProcurementPBG | /api/v1/procurement/pbg | procurement → /v1/procurement/pbg | ✓ `/v1/procurement/pbg` | ✓ | ✅ WIRED |
| procurement | /procurement/empanelment | getProcurementEmpanelment | /api/v1/procurement/empanelment | procurement → /v1/procurement/empanelment | ✓ `/v1/procurement/empanelment` | ✓ | ✅ WIRED |
| procurement | /procurement/gem | getProcurementGem | /api/v1/procurement/gem/items | procurement → /v1/procurement/gem/items | ✓ `/v1/procurement/gem/items` | ✓ | ✅ WIRED |
| procurement | /procurement/grn/[id] | getProcurementGRNById | /api/v1/procurement/grns/:param | procurement → /v1/procurement/grns/:param | ✓ `/v1/procurement/grns/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/grn/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/grn | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/indents/[id] | getProcurementIndentById | /api/v1/procurement/indents/:param | procurement → /v1/procurement/indents/:param | ✓ `/v1/procurement/indents/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/indents/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/indents | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/orders/[id] | getProcurementPOById | /api/v1/procurement/pos/:param | procurement → /v1/procurement/pos/:param | ✓ `/v1/procurement/pos/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/orders/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/orders | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/pre-bid | getProcurementPreBid | /api/v1/procurement/pre-bid-conferences | procurement → /v1/procurement/pre-bid-conferences | ✓ `/v1/procurement/pre-bid-conferences` | ✓ | ✅ WIRED |
| procurement | /procurement/reverse-auction | getProcurementReverseAuctions | /api/v1/procurement/reverse-auctions | procurement → /v1/procurement/reverse-auctions | ✓ `/v1/procurement/reverse-auctions` | ✓ | ✅ WIRED |
| procurement | /procurement/rfq/[id] | getRFQById | /api/v1/procurement/rfqs/:param | procurement → /v1/procurement/rfqs/:param | ✓ `/v1/procurement/rfqs/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/rfq/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/rfq | getRFQs | /api/v1/procurement/rfqs | procurement → /v1/procurement/rfqs | ✓ `/v1/procurement/rfqs` | ✓ | ✅ WIRED |
| procurement | /procurement/tenders/[id] | getProcurementTenderById | /api/v1/procurement/tenders/:param | procurement → /v1/procurement/tenders/:param | ✓ `/v1/procurement/tenders/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/tenders/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/tenders | getProcurementTenders | /api/v1/procurement/tenders | procurement → /v1/procurement/tenders | ✓ `/v1/procurement/tenders` | ✓ | ✅ WIRED |
| procurement | /procurement/vendors/[id] | getProcurementVendorById | /api/v1/procurement/vendors/:param | procurement → /v1/procurement/vendors/:param | ✓ `/v1/procurement/vendors/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/vendors/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/vendors | — | — | — | — | — | — NO_LOADER |
| projects | /projects/[id] | getProjectById | /api/v1/project/projects/:param | project → /v1/projects/projects/:param | ✓ `/v1/projects/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/beneficiaries | getProjectBeneficiaries | /api/v1/projects/beneficiaries | projects → /v1/projects/beneficiaries | ✓ `/v1/projects/beneficiaries` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getProjectsDashboard | /api/v1/project/dashboard | project → /v1/projects/dashboard | ✓ `/v1/projects/dashboard` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/delay-analysis | getProjectDelayAnalysis | /api/v1/projects/delay-analysis | projects → /v1/projects/delay-analysis | ✓ `/v1/projects/delay-analysis` | ✓ | ✅ WIRED |
| projects | /projects/dpr-tracking | getProjectDprs | /api/v1/projects/dprs | projects → /v1/projects/dprs | ✓ `/v1/projects/dprs` | ✓ | ✅ WIRED |
| projects | /projects/escalations | getProjectEscalations | /api/v1/projects/escalations | projects → /v1/projects/escalations | ✓ `/v1/projects/escalations` | ✓ | ✅ WIRED |
| projects | /projects/fund-releases | getProjectFundReleases | /api/v1/project/fund-releases | project → /v1/projects/fund-releases | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/list | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/milestones | getMilestones | /api/v1/project/milestones | project → /v1/projects/milestones | ✓ `/v1/projects/milestones` | ✓ | ✅ WIRED |
| projects | /projects/new | — | — | — | — | — | — NO_LOADER |
| projects | /projects | — | — | — | — | — | — NO_LOADER |
| projects | /projects/schemes/[id] | — | — | — | — | — | — NO_LOADER |
| projects | /projects/schemes | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/utilization | — | — | — | — | — | — NO_LOADER |
| projects | /projects/wbs | getProjectWbs | /api/v1/projects/wbs | projects → /v1/projects/wbs | ✓ `/v1/projects/wbs` | ✓ | ✅ WIRED |
| recommendations | /recommendations/feedback | — | — | — | — | — | — NO_LOADER |
| recommendations | /recommendations/health | — | — | — | — | — | — NO_LOADER |
| recommendations | /recommendations/matrix | — | — | — | — | — | — NO_LOADER |
| recommendations | /recommendations/nba | — | — | — | — | — | — NO_LOADER |
| recommendations | /recommendations | — | — | — | — | — | — NO_LOADER |
| reports | /reports/[id] | getReportJobById | /api/v1/reports/report-jobs/:param | reports → /v1/reports/report-jobs/:param | ✓ `/v1/reports/report-jobs/:id` | ✓ | ✅ WIRED |
| reports | /reports/dashboard | getReportsDashboard | /api/v1/reports/dashboards | reports → /v1/reports/dashboards | ✓ `/v1/reports/dashboards` | ✓ | ✅ WIRED |
| reports | /reports/kpi | getKPIs | /api/v1/reports/kpis | reports → /v1/reports/kpis | ✓ `/v1/reports/kpis` | ✓ | ✅ WIRED |
| reports | /reports/list/new | — | — | — | — | — | — NO_LOADER |
| reports | /reports/list | getReportJobs | /api/v1/reports/report-jobs | reports → /v1/reports/report-jobs | ✓ `/v1/reports/report-jobs` | ✓ | ✅ WIRED |
| reports | /reports/mis | getMISSummary | /api/v1/reports/mis | reports → /v1/reports/mis | ✓ `/v1/reports/mis` | ✓ | ✅ WIRED |
| reports | /reports | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/adjustments | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/analytics | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/assessees/[id] | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/assessees | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/assessments | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/bbps | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/bills | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/config | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/instalments | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/receipts | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/recovery | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/refunds/[id]/decide | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/refunds | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/write-offs/[id]/decide | — | — | — | — | — | — NO_LOADER |
| revenue | /revenue/write-offs | — | — | — | — | — | — NO_LOADER |
| settings | /settings/branding | — | — | — | — | — | — NO_LOADER |
| setup | /setup | — | — | — | — | — | — NO_LOADER |
| stock | /stock/[id] | getStockItemById | /api/v1/stock/items/:param | stock → /v1/stock/items/:param | ✓ `/v1/stock/items/:id` | ✓ | ✅ WIRED |
| stock | /stock/dashboard | getStockDashboard | /api/v1/stock/dashboard | stock → /v1/stock/dashboard | ✓ `/v1/stock/dashboard` | ✓ | ✅ WIRED |
| stock | /stock/items/new | — | — | — | — | — | — NO_LOADER |
| stock | /stock/ledger/new | — | — | — | — | — | — NO_LOADER |
| stock | /stock/ledger | getStockLedger | /api/v1/stock/ledger | stock → /v1/stock/ledger | ✓ `/v1/stock/ledger` | ✓ | ✅ WIRED |
| stock | /stock/list | getStockItems | /api/v1/stock/items | stock → /v1/stock/items | ✓ `/v1/stock/items` | ✓ | ✅ WIRED |
| stock | /stock | — | — | — | — | — | — NO_LOADER |
| telephony | /telephony/agents | — | — | — | — | — | — NO_LOADER |
| telephony | /telephony/calls | — | — | — | — | — | — NO_LOADER |
| telephony | /telephony/dispositions | — | — | — | — | — | — NO_LOADER |
| telephony | /telephony/list | getTelephonyCalls | /api/v1/telephony/calls | telephony → /v1/telephony/calls | ✓ `/v1/telephony/calls` | ✓ | ✅ WIRED |
| telephony | /telephony | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/code-lists | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/consent-exchange | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/data-migration | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/org-hierarchy | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/overview | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/plans | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/positions | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/quotas | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/settings | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/stewardship | — | — | — | — | — | — NO_LOADER |
| tenant | /tenant/subscriptions | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/activation | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/ai-plugins | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/api-keys | getAPIKeys | /api/v1/admin/api-keys | admin → /v1/admin/api-keys | ✓ `/v1/admin/api-keys` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/audit | getTenantAuditLog | /api/v1/audit/events | audit → /v1/audit/events | ✓ `/v1/audit/events` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/breakglass/[id] | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/breakglass | getBreakglassLog | /api/v1/admin/breakglass | admin → /v1/admin/breakglass | ✓ `/v1/admin/breakglass` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/compliance | getComplianceOverview | /api/v1/admin/compliance | admin → /v1/admin/compliance | ✓ `/v1/admin/compliance` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/data-export | getDataExports | /api/v1/admin/data-exports | admin → /v1/admin/data-exports | ✓ `/v1/admin/data-exports` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/domain | getCustomDomains | /api/v1/admin/domains | admin → /v1/admin/domains | ✓ `/v1/admin/domains` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/idp | getIdpProviders | /api/v1/admin/idp/providers | admin → /v1/admin/idp/providers | ✓ `/v1/admin/idp/providers` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/install | getInstallSteps | /api/v1/install/steps | install → /v1/install/steps | ✓ `/v1/install/steps` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/mfa | getMfaUsers | /api/v1/admin/mfa/users | admin → /v1/admin/mfa/users | ✓ `/v1/admin/mfa/users` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/notifications/channels | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/notifications | getNotificationPreferences | /api/notification/preferences | notification → /notifications/preferences | ✓ `/notifications/preferences` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/operations | getAdminOperationsDashboard | /api/v1/admin/operations | admin → /v1/admin/operations | ✓ `/v1/admin/operations` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/org-hierarchy | getOrgHierarchy | /api/v1/admin/org-hierarchy | admin → /v1/admin/org-hierarchy | ✓ `/v1/admin/org-hierarchy` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/org-type | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin | getTenantAdminDashboard | /api/v1/admin/health | admin → /v1/admin/health | ✓ `/v1/admin/health` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/plans | getPlansData | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/platform-config | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/readiness | getTenantAdminDashboard | /api/v1/admin/health | admin → /v1/admin/health | ✓ `/v1/admin/health` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles/[id] | getAdminRoleById | /api/policy/roles/:param | policy → /policy/roles/:param | ✓ `/policy/roles/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles | getAdminRoles | /api/policy/roles | policy → /policy/roles | ✓ `/policy/roles` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/security | getSecurityOverview | /api/v1/admin/security/overview | admin → /v1/admin/security/overview | ✓ `/v1/admin/security/overview` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/sessions/[id] | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/sessions | getActiveSessions | /api/identity/sessions | identity → /identity/sessions | ✓ `/identity/sessions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/settings | getTenantModules | /api/v1/admin/tenant/modules | admin → /v1/admin/tenant/modules | ✓ `/v1/admin/tenant/modules` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/siem | getSiemAlerts | /api/v1/admin/siem/alerts | admin → /v1/admin/siem/alerts | ✓ `/v1/admin/siem/alerts` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/sso | getSsoProviders | /api/v1/admin/sso/providers | admin → /v1/admin/sso/providers | ✓ `/v1/admin/sso/providers` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/subscription | getSubscription | /api/v1/billing/subscriptions | billing → /v1/billing/subscriptions | ✓ `/v1/billing/subscriptions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/usage | getUsageQuotas | /api/v1/admin/usage | admin → /v1/admin/usage | ✓ `/v1/admin/usage` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users/[id] | getAdminUserById | /api/identity/users/:param | identity → /identity/users/:param | ✓ `/identity/users/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users | getAdminUsers | /api/identity/users | identity → /identity/users | ✓ `/identity/users` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/webhooks | getWebhooks | /api/v1/admin/webhooks | admin → /v1/admin/webhooks | ✓ `/v1/admin/webhooks` | ✓ | ✅ WIRED |
| themes | /themes/brand | — | — | — | — | — | — NO_LOADER |
| themes | /themes/branding | — | — | — | — | — | — NO_LOADER |
| themes | /themes | — | — | — | — | — | — NO_LOADER |
| themes | /themes/templates | — | — | — | — | — | — NO_LOADER |
| themes | /themes/tokens | getThemeTokens | /api/v1/themes/tokens | theme → /v1/themes/tokens | ✓ `/v1/themes/tokens` | ✓ | ✅ WIRED |
| visitor | /visitor/admin | — | — | — | — | — | — NO_LOADER |
| visitor | /visitor/guard | — | — | — | — | — | — NO_LOADER |
| visitor | /visitor/host | — | — | — | — | — | — NO_LOADER |
| visitor | /visitor | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/definitions/[id] | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/definitions | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/designer | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/instances/[id] | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/list | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/my-tasks | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow | — | — | — | — | — | — NO_LOADER |
| works | /works/approvals | — | — | — | — | — | — NO_LOADER |
| works | /works/billing | — | — | — | — | — | — NO_LOADER |
| works | /works/boq | — | — | — | — | — | — NO_LOADER |
| works | /works/closure | — | — | — | — | — | — NO_LOADER |
| works | /works/execution | — | — | — | — | — | — NO_LOADER |
| works | /works | — | — | — | — | — | — NO_LOADER |
| works | /works/proposals | — | — | — | — | — | — NO_LOADER |
| works | /works/tenders | — | — | — | — | — | — NO_LOADER |
