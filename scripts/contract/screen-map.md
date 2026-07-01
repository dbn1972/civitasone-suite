# Screen Contract Map

Generated: 2026-07-01T10:18:21.207Z

**Summary:** 150 WIRED | 0 MISSING | 0 MISMATCH | 255 NO_LOADER

| module | screen | loader | apiPath | upstream | route? | table? | status |
|--------|--------|--------|---------|----------|--------|--------|--------|
| admin | /admin/api-monitoring | — | — | — | — | — | — NO_LOADER |
| admin | /admin/devices | — | — | — | — | — | — NO_LOADER |
| admin | /admin/editions | — | — | — | — | — | — NO_LOADER |
| admin | /admin/entitlements | — | — | — | — | — | — NO_LOADER |
| admin | /admin/feature-flags | — | — | — | — | — | — NO_LOADER |
| admin | /admin/gateways | — | — | — | — | — | — NO_LOADER |
| admin | /admin/invoices | — | — | — | — | — | — NO_LOADER |
| admin | /admin/metering | — | — | — | — | — | — NO_LOADER |
| admin | /admin/onboarding | — | — | — | — | — | — NO_LOADER |
| admin | /admin/operators | — | — | — | — | — | — NO_LOADER |
| admin | /admin | — | — | — | — | — | — NO_LOADER |
| admin | /admin/sa-dashboard | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tech-admin | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tenant-provision | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tenants/[id] | — | — | — | — | — | — NO_LOADER |
| admin | /admin/tenants | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/ai-insights | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/dashboards | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/data-warehouse | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/kpi | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/list | getAnalyticsDashboards | /api/v1/analytics/dashboards | analytics → /v1/analytics/dashboards | ✓ `/v1/analytics/dashboards` | ✓ | ✅ WIRED |
| analytics | /analytics | — | — | — | — | — | — NO_LOADER |
| analytics | /analytics/queries | — | — | — | — | — | — NO_LOADER |
| assets | /assets/[id] | getAssetById | /api/v1/asset/assets/:param | asset → /v1/assets/assets/:param | ✓ `/v1/assets/assets/:id` | ✓ | ✅ WIRED |
| assets | /assets/bulk-import | — | — | — | — | — | — NO_LOADER |
| assets | /assets/dashboard | getAssetDashboard | /api/v1/asset/dashboard | asset → /v1/assets/dashboard | ✓ `/v1/assets/dashboard` | ✓ | ✅ WIRED |
| assets | /assets/depreciation | — | — | — | — | — | — NO_LOADER |
| assets | /assets/fixed-assets | getFixedAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/infra | getInfraAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
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
| audit | /audit/cag | — | — | — | — | — | — NO_LOADER |
| audit | /audit/compliance | getAuditCompliance | /api/v1/audit/compliance | audit → /v1/audit/compliance | ✓ `/v1/audit/compliance` | ✓ | ✅ WIRED |
| audit | /audit/dashboard | getAuditDashboard | /api/v1/audit/dashboard | audit → /v1/audit/dashboard | ✓ `/v1/audit/dashboard` | ✓ | ✅ WIRED |
| audit | /audit/exports | getAuditExports | /api/v1/audit/exports | audit → /v1/audit/exports | ✓ `/v1/audit/exports` | ✓ | ✅ WIRED |
| audit | /audit/investigation | — | — | — | — | — | — NO_LOADER |
| audit | /audit/observations/[id] | getAuditObservationById | /api/v1/audit/observations/:param | audit → /v1/audit/observations/:param | ✓ `/v1/audit/observations/:id` | ✓ | ✅ WIRED |
| audit | /audit/observations | getAuditObservations | /api/v1/audit/observations | audit → /v1/audit/observations | ✓ `/v1/audit/observations` | ✓ | ✅ WIRED |
| audit | /audit | getAuditItems | /api/audit/events | audit-events → /audit/events | ✓ `/audit/events` | ✓ | ✅ WIRED |
| audit | /audit/plan | getAuditPlan | /api/v1/audit/plan | audit → /v1/audit/plan | ✓ `/v1/audit/plan` | ✓ | ✅ WIRED |
| audit | /audit/risk-register | getRiskRegister | /api/v1/audit/risks | audit → /v1/audit/risks | ✓ `/v1/audit/risks` | ✓ | ✅ WIRED |
| audit | /audit/vigilance | — | — | — | — | — | — NO_LOADER |
| billing | /billing/invoices | getBillingInvoices | /api/v1/billing/invoices | billing → /v1/billing/invoices | ✓ `/v1/billing/invoices` | ✓ | ✅ WIRED |
| billing | /billing/list | getBillingPlans | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| billing | /billing | — | — | — | — | — | — NO_LOADER |
| billing | /billing/payments | getBillingPayments | /api/v1/billing/payments | billing → /v1/billing/payments | ✓ `/v1/billing/payments` | ✓ | ✅ WIRED |
| billing | /billing/plans/[id] | — | — | — | — | — | — NO_LOADER |
| billing | /billing/plans/new | — | — | — | — | — | — NO_LOADER |
| billing | /billing/plans | getBillingPlans | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| billing | /billing/subscriptions | getBillingSubscriptions | /api/v1/billing/subscriptions | billing → /v1/billing/subscriptions | ✓ `/v1/billing/subscriptions` | ✓ | ✅ WIRED |
| citizen | /citizen/alerts | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/feedback | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/grievances/new | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/grievances | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/notices | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/portal | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/requests/[id] | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/requests | getCitizenRequests | /api/v1/citizen/requests | citizen → /v1/citizen/requests | ✓ `/v1/citizen/requests` | ✓ | ✅ WIRED |
| citizen | /citizen/rti/[id] | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/rti | getRTIApplications | /api/v1/citizen/rti | citizen → /v1/citizen/rti | ✓ `/v1/citizen/rti` | ✓ | ✅ WIRED |
| citizen | /citizen/surveys | — | — | — | — | — | — NO_LOADER |
| contracts | /contracts/[id] | — | — | — | — | — | — NO_LOADER |
| contracts | /contracts/list | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| contracts | /contracts/new | — | — | — | — | — | — NO_LOADER |
| contracts | /contracts | — | — | — | — | — | — NO_LOADER |
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
| crm | /crm | — | — | — | — | — | — NO_LOADER |
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
| estab | /estab/list | getEstabFiles | /api/v1/estab/files | estab → /v1/estab/files | ✓ `/v1/estab/files` | ✓ | ✅ WIRED |
| estab | /estab/meetings/[id] | getMeetingById | /api/v1/estab/meetings/:param | estab → /v1/estab/meetings/:param | ✓ `/v1/estab/meetings/:id` | ✓ | ✅ WIRED |
| estab | /estab/meetings | getMeetings | /api/v1/estab/meetings | estab → /v1/estab/meetings | ✓ `/v1/estab/meetings` | ✓ | ✅ WIRED |
| estab | /estab/migration | — | — | — | — | — | — NO_LOADER |
| estab | /estab/notifications | — | — | — | — | — | — NO_LOADER |
| estab | /estab/operators | — | — | — | — | — | — NO_LOADER |
| estab | /estab | — | — | — | — | — | — NO_LOADER |
| estab | /estab/vehicles | getVehicles | /api/v1/estab/vehicles | estab → /v1/estab/vehicles | ✓ `/v1/estab/vehicles` | ✓ | ✅ WIRED |
| estab | /estab/workspace | — | — | — | — | — | — NO_LOADER |
| establishment | /establishment/files | — | — | — | — | — | — NO_LOADER |
| establishment | /establishment | — | — | — | — | — | — NO_LOADER |
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
| finance | /finance/journal-entry | getChartOfAccounts | /api/v1/finance/accounts | finance → /v1/finance/accounts | ✓ `/v1/finance/accounts` | ✓ | ✅ WIRED |
| finance | /finance/licenses/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/licenses | — | — | — | — | — | — NO_LOADER |
| finance | /finance | — | — | — | — | — | — NO_LOADER |
| finance | /finance/payments/[id] | — | — | — | — | — | — NO_LOADER |
| finance | /finance/payments | getPayments | /api/v1/finance/payments | finance → /v1/finance/payments | ✓ `/v1/finance/payments` | ✓ | ✅ WIRED |
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
| finance | /finance/vendors | — | — | — | — | — | — NO_LOADER |
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
| hr | /hr/payroll/gpf | getGpfStatements | /api/v1/payroll/statutory/gpf | payroll → /v1/payroll/statutory/gpf | ✓ `/v1/payroll/statutory/gpf` | ✓ | ✅ WIRED |
| hr | /hr/payroll/income-tax | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/nps | getNpsStatements | /api/v1/payroll/statutory/nps | payroll → /v1/payroll/statutory/nps | ✓ `/v1/payroll/statutory/nps` | ✓ | ✅ WIRED |
| hr | /hr/payroll | getPayrollRunDetails | /api/v1/payroll/runs | payroll → /v1/payroll/runs | ✓ `/v1/payroll/runs` | ✓ | ✅ WIRED |
| hr | /hr/payroll | getPayrollStructures | /api/v1/payroll/structures | payroll → /v1/payroll/structures | ✓ `/v1/payroll/structures` | ✓ | ✅ WIRED |
| hr | /hr/payroll/pensioners/new | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/pensioners | getPensioners | /api/v1/payroll/pensioners | payroll → /v1/payroll/pensioners | ✓ `/v1/payroll/pensioners` | ✓ | ✅ WIRED |
| hr | /hr/payroll/period | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/salary-slips/[id] | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/salary-slips | getSalarySlips | /api/v1/payroll/salary-slips | payroll → /v1/payroll/salary-slips | ✓ `/v1/payroll/salary-slips` | ✓ | ✅ WIRED |
| hr | /hr/payroll/slips/[id] | getSlipById | /api/v1/payroll/slips/:param | payroll → /v1/payroll/slips/:param | ✓ `/v1/payroll/slips/:id` | ✓ | ✅ WIRED |
| hr | /hr/payroll/statutory | — | — | — | — | — | — NO_LOADER |
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
| install | /install | getInstallSteps | /api/v1/install/steps | install → /v1/install/steps | ✓ `/v1/install/steps` | ✓ | ✅ WIRED |
| inventory | /inventory/issues | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/items | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/list | getStockItems | /api/v1/stock/items | stock → /v1/stock/items | ✓ `/v1/stock/items` | ✓ | ✅ WIRED |
| inventory | /inventory/low-stock | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/receipts | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/reconcile | getStockLedger | /api/v1/stock/ledger | stock → /v1/stock/ledger | ✓ `/v1/stock/ledger` | ✓ | ✅ WIRED |
| knowledge | /knowledge/dashboard | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/documents/new | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/list | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/records | getKnowledgeRecords | /api/v1/knowledge/records | knowledge → /v1/knowledge/records | ✓ `/v1/knowledge/records` | ✓ | ✅ WIRED |
| knowledge | /knowledge/repository | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/search | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
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
| locations | /locations/list | getLocations | /api/v1/locations | locations → /v1/locations/ | ✓ `/v1/locations` | ✓ | ✅ WIRED |
| locations | /locations | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/compose | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/deliveries/[id] | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/deliveries | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/list | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/templates/[id] | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/templates | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins | getPlugins | /api/v1/plugins/items | plugin → /v1/plugins/items | ✓ `/v1/plugins/items` | ✓ | ✅ WIRED |
| procurement | /procurement/approvals/escalation | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/approvals | getProcurementApprovals | /api/v1/procurement/approvals | procurement → /v1/procurement/approvals | ✓ `/v1/procurement/approvals` | ✓ | ✅ WIRED |
| procurement | /procurement/bid-evaluation | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/contracts/new | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/contracts | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| procurement | /procurement/dashboard | getProcurementDashboard | /api/v1/procurement/dashboard | procurement → /v1/procurement/dashboard | ✓ `/v1/procurement/dashboard` | ✓ | ✅ WIRED |
| procurement | /procurement/emd-bg | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/empanelment | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/gem | — | — | — | — | — | — NO_LOADER |
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
| procurement | /procurement/pre-bid | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/reverse-auction | — | — | — | — | — | — NO_LOADER |
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
| projects | /projects/beneficiaries | — | — | — | — | — | — NO_LOADER |
| projects | /projects/dashboard | getProjectsDashboard | /api/v1/project/dashboard | project → /v1/projects/dashboard | ✓ `/v1/projects/dashboard` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/delay-analysis | — | — | — | — | — | — NO_LOADER |
| projects | /projects/dpr-tracking | — | — | — | — | — | — NO_LOADER |
| projects | /projects/escalations | — | — | — | — | — | — NO_LOADER |
| projects | /projects/fund-releases | getProjectFundReleases | /api/v1/project/fund-releases | project → /v1/projects/fund-releases | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/list | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/milestones | getMilestones | /api/v1/project/milestones | project → /v1/projects/milestones | ✓ `/v1/projects/milestones` | ✓ | ✅ WIRED |
| projects | /projects/new | — | — | — | — | — | — NO_LOADER |
| projects | /projects | — | — | — | — | — | — NO_LOADER |
| projects | /projects/schemes/[id] | — | — | — | — | — | — NO_LOADER |
| projects | /projects/schemes | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/utilization | — | — | — | — | — | — NO_LOADER |
| projects | /projects/wbs | — | — | — | — | — | — NO_LOADER |
| reports | /reports/[id] | getReportJobById | /api/v1/reports/report-jobs/:param | reports → /v1/reports/report-jobs/:param | ✓ `/v1/reports/report-jobs/:id` | ✓ | ✅ WIRED |
| reports | /reports/dashboard | getReportsDashboard | /api/v1/reports/dashboards | reports → /v1/reports/dashboards | ✓ `/v1/reports/dashboards` | ✓ | ✅ WIRED |
| reports | /reports/kpi | getKPIs | /api/v1/reports/kpis | reports → /v1/reports/kpis | ✓ `/v1/reports/kpis` | ✓ | ✅ WIRED |
| reports | /reports/list/new | — | — | — | — | — | — NO_LOADER |
| reports | /reports/list | getReportJobs | /api/v1/reports/report-jobs | reports → /v1/reports/report-jobs | ✓ `/v1/reports/report-jobs` | ✓ | ✅ WIRED |
| reports | /reports/mis | getMISSummary | /api/v1/reports/mis | reports → /v1/reports/mis | ✓ `/v1/reports/mis` | ✓ | ✅ WIRED |
| reports | /reports | — | — | — | — | — | — NO_LOADER |
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
| tenant-admin | /tenant-admin/activation | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/ai-plugins | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/api-keys | getAPIKeys | /api/v1/admin/api-keys | admin → /v1/admin/api-keys | ✓ `/v1/admin/api-keys` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/audit | getTenantAuditLog | /api/v1/audit/events | audit → /v1/audit/events | ✓ `/v1/audit/events` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/breakglass/[id] | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/breakglass | getBreakglassLog | /api/v1/admin/breakglass | admin → /v1/admin/breakglass | ✓ `/v1/admin/breakglass` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/compliance | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/idp | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/install | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/mfa | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/notifications/channels | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/notifications | getNotificationPreferences | /api/notification/preferences | notification → /notifications/preferences | ✓ `/notifications/preferences` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/operations | getAdminOperationsDashboard | /api/v1/admin/operations | admin → /v1/admin/operations | ✓ `/v1/admin/operations` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/org-hierarchy | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/org-type | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin | getTenantAdminDashboard | /api/v1/admin/health | admin → /v1/admin/health | ✓ `/v1/admin/health` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/platform-config | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/readiness | getTenantAdminDashboard | /api/v1/admin/health | admin → /v1/admin/health | ✓ `/v1/admin/health` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles/[id] | getAdminRoleById | /api/policy/roles/:param | policy → /policy/roles/:param | ✓ `/policy/roles/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles | getAdminRoles | /api/policy/roles | policy → /policy/roles | ✓ `/policy/roles` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/security | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/sessions/[id] | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/sessions | getActiveSessions | /api/identity/sessions | identity → /identity/sessions | ✓ `/identity/sessions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/settings | getTenantModules | /api/v1/admin/tenant/modules | admin → /v1/admin/tenant/modules | ✓ `/v1/admin/tenant/modules` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/siem | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/sso | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/subscription | getSubscription | /api/v1/billing/subscriptions | billing → /v1/billing/subscriptions | ✓ `/v1/billing/subscriptions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users/[id] | getAdminUserById | /api/identity/users/:param | identity → /identity/users/:param | ✓ `/identity/users/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users | getAdminUsers | /api/identity/users | identity → /identity/users | ✓ `/identity/users` | ✓ | ✅ WIRED |
| themes | /themes | getThemeTokens | /api/v1/themes/tokens | theme → /v1/themes/tokens | ✓ `/v1/themes/tokens` | ✓ | ✅ WIRED |
| workflow | /workflow/definitions/[id] | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/definitions | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/instances/[id] | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/list | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow/my-tasks | — | — | — | — | — | — NO_LOADER |
| workflow | /workflow | — | — | — | — | — | — NO_LOADER |
