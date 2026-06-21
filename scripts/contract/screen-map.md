# Screen Contract Map

Generated: 2026-06-20T23:06:23.928Z

**Summary:** 135 WIRED | 0 MISSING | 0 MISMATCH | 30 NO_LOADER

| module | screen | loader | apiPath | upstream | route? | table? | status |
|--------|--------|--------|---------|----------|--------|--------|--------|
| analytics | /analytics/list | getAnalyticsDashboards | /api/v1/analytics/dashboards | analytics → /v1/analytics/dashboards | ✓ `/v1/analytics/dashboards` | ✓ | ✅ WIRED |
| analytics | /analytics | — | — | — | — | — | — NO_LOADER |
| assets | /assets/[id] | getAssetById | /api/v1/asset/assets/:param | asset → /v1/assets/assets/:param | ✓ `/v1/assets/assets/:id` | ✓ | ✅ WIRED |
| assets | /assets/dashboard | getAssetDashboard | /api/v1/asset/dashboard | asset → /v1/assets/dashboard | ✓ `/v1/assets/dashboard` | ✓ | ✅ WIRED |
| assets | /assets/fixed-assets | getFixedAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/infra | getInfraAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/list | getAssets | /api/v1/asset/assets | asset → /v1/assets/assets | ✓ `/v1/assets/assets` | ✓ | ✅ WIRED |
| assets | /assets/maintenance | getAssetMaintenance | /api/v1/asset/maintenance | asset → /v1/assets/maintenance | ✓ `/v1/assets/maintenance` | ✓ | ✅ WIRED |
| assets | /assets | — | — | — | — | — | — NO_LOADER |
| audit | /audit/compliance | getAuditCompliance | /api/v1/audit/compliance | audit → /v1/audit/compliance | ✓ `/v1/audit/compliance` | ✓ | ✅ WIRED |
| audit | /audit/dashboard | getAuditDashboard | /api/v1/audit/dashboard | audit → /v1/audit/dashboard | ✓ `/v1/audit/dashboard` | ✓ | ✅ WIRED |
| audit | /audit/exports | getAuditExports | /api/v1/audit/exports | audit → /v1/audit/exports | ✓ `/v1/audit/exports` | ✓ | ✅ WIRED |
| audit | /audit/observations/[id] | getAuditObservationById | /api/v1/audit/observations/:param | audit → /v1/audit/observations/:param | ✓ `/v1/audit/observations/:id` | ✓ | ✅ WIRED |
| audit | /audit/observations | getAuditObservations | /api/v1/audit/observations | audit → /v1/audit/observations | ✓ `/v1/audit/observations` | ✓ | ✅ WIRED |
| audit | /audit | getAuditItems | /api/audit/events | audit-events → /audit/events | ✓ `/audit/events` | ✓ | ✅ WIRED |
| audit | /audit/plan | getAuditPlan | /api/v1/audit/plan | audit → /v1/audit/plan | ✓ `/v1/audit/plan` | ✓ | ✅ WIRED |
| audit | /audit/risk-register | getRiskRegister | /api/v1/audit/risks | audit → /v1/audit/risks | ✓ `/v1/audit/risks` | ✓ | ✅ WIRED |
| billing | /billing/list | getBillingPlans | /api/v1/billing/plans | billing → /v1/billing/plans | ✓ `/v1/billing/plans` | ✓ | ✅ WIRED |
| billing | /billing | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen | — | — | — | — | — | — NO_LOADER |
| citizen | /citizen/requests | getCitizenRequests | /api/v1/citizen/requests | citizen → /v1/citizen/requests | ✓ `/v1/citizen/requests` | ✓ | ✅ WIRED |
| citizen | /citizen/rti | getRTIApplications | /api/v1/citizen/rti | citizen → /v1/citizen/rti | ✓ `/v1/citizen/rti` | ✓ | ✅ WIRED |
| contracts | /contracts/list | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| contracts | /contracts | — | — | — | — | — | — NO_LOADER |
| crm | /crm/activities | getCRMActivities | /api/v1/crm/activities | crm → /v1/crm/activities | ✓ `/v1/crm/activities` | ✓ | ✅ WIRED |
| crm | /crm/contacts/[id] | getContactById | /api/v1/crm/contacts/:param | crm → /v1/crm/contacts/:param | ✓ `/v1/crm/contacts/:id` | ✓ | ✅ WIRED |
| crm | /crm/contacts | getCrmContacts | /api/v1/crm/contacts | crm → /v1/crm/contacts | ✓ `/v1/crm/contacts` | ✓ | ✅ WIRED |
| crm | /crm/dashboard | getCRMDashboard | /api/v1/crm/dashboard | crm → /v1/crm/dashboard | ✓ `/v1/crm/dashboard` | ✓ | ✅ WIRED |
| crm | /crm/deals/[id] | getDealById | /api/v1/crm/deals/:param | crm → /v1/crm/deals/:param | ✓ `/v1/crm/deals/:id` | ✓ | ✅ WIRED |
| crm | /crm/deals | getDeals | /api/v1/crm/deals | crm → /v1/crm/deals | ✓ `/v1/crm/deals` | ✓ | ✅ WIRED |
| crm | /crm | — | — | — | — | — | — NO_LOADER |
| dashboard | /dashboard | — | — | — | — | — | — NO_LOADER |
| developer-portal | /developer-portal | — | — | — | — | — | — NO_LOADER |
| estab | /estab/compliance | getEstabCompliance | /api/v1/estab/compliance | estab → /v1/estab/compliance | ✓ `/v1/estab/compliance` | ✓ | ✅ WIRED |
| estab | /estab/dashboard | getEstabDashboard | /api/v1/estab/dashboard | estab → /v1/estab/dashboard | ✓ `/v1/estab/dashboard` | ✓ | ✅ WIRED |
| estab | /estab/files/[id] | getEstabFileById | /api/v1/estab/files/:param | estab → /v1/estab/files/:param | ✓ `/v1/estab/files/:id` | ✓ | ✅ WIRED |
| estab | /estab/files/new | — | — | — | — | — | — NO_LOADER |
| estab | /estab/guesthouse | getGuesthouseBookings | /api/v1/estab/guesthouse-bookings | estab → /v1/estab/guesthouse-bookings | ✓ `/v1/estab/guesthouse-bookings` | ✓ | ✅ WIRED |
| estab | /estab/list | getEstabFiles | /api/v1/estab/files | estab → /v1/estab/files | ✓ `/v1/estab/files` | ✓ | ✅ WIRED |
| estab | /estab/meetings/[id] | getMeetingById | /api/v1/estab/meetings/:param | estab → /v1/estab/meetings/:param | ✓ `/v1/estab/meetings/:id` | ✓ | ✅ WIRED |
| estab | /estab/meetings | getMeetings | /api/v1/estab/meetings | estab → /v1/estab/meetings | ✓ `/v1/estab/meetings` | ✓ | ✅ WIRED |
| estab | /estab | — | — | — | — | — | — NO_LOADER |
| estab | /estab/vehicles | getVehicles | /api/v1/estab/vehicles | estab → /v1/estab/vehicles | ✓ `/v1/estab/vehicles` | ✓ | ✅ WIRED |
| finance | /finance/accounting/financial-statements | getFinancialStatements | /api/v1/finance/statements | finance → /v1/finance/statements | ✓ `/v1/finance/statements` | ✓ | ✅ WIRED |
| finance | /finance/accounting/general-ledger | getFinanceGLEntries | /api/v1/finance/journals | finance → /v1/finance/journals | ✓ `/v1/finance/journals` | ✓ | ✅ WIRED |
| finance | /finance/accounting/vouchers/new | — | — | — | — | — | — NO_LOADER |
| finance | /finance/budget/formulation | getFinanceBudgets | /api/v1/finance/budgets | finance → /v1/finance/budgets | ✓ `/v1/finance/budgets` | ✓ | ✅ WIRED |
| finance | /finance/budget/sanctions/[id] | getFinanceSanctionById | /api/v1/finance/sanctions/:param | finance → /v1/finance/sanctions/:param | ✓ `/v1/finance/sanctions/:id` | ✓ | ✅ WIRED |
| finance | /finance/budget/sanctions | getFinanceSanctions | /api/v1/finance/sanctions | finance → /v1/finance/sanctions | ✓ `/v1/finance/sanctions` | ✓ | ✅ WIRED |
| finance | /finance/chart-of-accounts | getChartOfAccounts | /api/v1/finance/accounts | finance → /v1/finance/accounts | ✓ `/v1/finance/accounts` | ✓ | ✅ WIRED |
| finance | /finance/dashboard | getFinanceDashboard | /api/v1/finance/dashboard | finance → /v1/finance/dashboard | ✓ `/v1/finance/dashboard` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/advances | getFinanceAdvances | /api/v1/finance/advances | finance → /v1/finance/advances | ✓ `/v1/finance/advances` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/bills/[id] | getFinanceBillById | /api/v1/finance/bills/:param | finance → /v1/finance/bills/:param | ✓ `/v1/finance/bills/:id` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/bills | getFinanceBills | /api/v1/finance/bills | finance → /v1/finance/bills | ✓ `/v1/finance/bills` | ✓ | ✅ WIRED |
| finance | /finance/expenditure/utilization-certificates | getFinanceUCs | /api/v1/finance/utilization-certificates | finance → /v1/finance/utilization-certificates | ✓ `/v1/finance/utilization-certificates` | ✓ | ✅ WIRED |
| finance | /finance/journal-entry | — | — | — | — | — | — NO_LOADER |
| finance | /finance | — | — | — | — | — | — NO_LOADER |
| finance | /finance/payments | getPayments | /api/v1/finance/payments | finance → /v1/finance/payments | ✓ `/v1/finance/payments` | ✓ | ✅ WIRED |
| grants | /grants/[id] | getGrantById | /api/v1/grants/grants/:param | grant → /v1/grants/grants/:param | ✓ `/v1/grants/grants/:id` | ✓ | ✅ WIRED |
| grants | /grants/dashboard | getGrantsDashboard | /api/v1/grants/dashboard | grant → /v1/grants/dashboard | ✓ `/v1/grants/dashboard` | ✓ | ✅ WIRED |
| grants | /grants/dashboard | getGrants | /api/v1/grants/grants | grant → /v1/grants/grants | ✓ `/v1/grants/grants` | ✓ | ✅ WIRED |
| grants | /grants/grantees | getGrantees | /api/v1/grants/grantees | grant → /v1/grants/grantees | ✓ `/v1/grants/grantees` | ✓ | ✅ WIRED |
| grants | /grants/installments | getGrantInstallments | /api/v1/grants/installments | grant → /v1/grants/installments | ✓ `/v1/grants/installments` | ✓ | ✅ WIRED |
| grants | /grants/list | getGrants | /api/v1/grants/grants | grant → /v1/grants/grants | ✓ `/v1/grants/grants` | ✓ | ✅ WIRED |
| grants | /grants | — | — | — | — | — | — NO_LOADER |
| grants | /grants/releases | getGrantReleases | /api/v1/grants/releases | grant → /v1/grants/releases | ✓ `/v1/grants/releases` | ✓ | ✅ WIRED |
| grants | /grants/utilization | getGrantUtilization | /api/v1/grants/utilization-certs | grant → /v1/grants/utilization-certs | ✓ `/v1/grants/utilization-certs` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/internal | getInternalHelpdeskTickets | /api/v1/helpdesk/tickets | helpdesk → /v1/helpdesk/tickets | ✓ `/v1/helpdesk/tickets` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk | — | — | — | — | — | — NO_LOADER |
| helpdesk | /helpdesk/reports | getTicketAnalytics | /api/v1/citizen/tickets/analytics | citizen → /v1/citizen/tickets/analytics | ✓ `/v1/citizen/tickets/analytics` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/slas | getBreachedSLATickets | /api/v1/citizen/tickets | citizen → /v1/citizen/tickets | ✓ `/v1/citizen/tickets` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/tickets/[id] | getHelpdeskTicketById | /api/v1/citizen/tickets/:param | citizen → /v1/citizen/tickets/:param | ✓ `/v1/citizen/tickets/:id` | ✓ | ✅ WIRED |
| helpdesk | /helpdesk/tickets | getHelpdeskTicketList | /api/v1/citizen/tickets | citizen → /v1/citizen/tickets | ✓ `/v1/citizen/tickets` | ✓ | ✅ WIRED |
| hr | /hr/appraisals | getAppraisals | /api/v1/hrms/appraisals | hrms → /v1/hrms/appraisals | ✓ `/v1/hrms/appraisals` | ✓ | ✅ WIRED |
| hr | /hr/attendance | getAttendanceList | /api/v1/hrms/attendance | hrms → /v1/hrms/attendance | ✓ `/v1/hrms/attendance` | ✓ | ✅ WIRED |
| hr | /hr/attendance/regularisation | getAttendanceRegularisations | /api/v1/hrms/attendance/regularisations | hrms → /v1/hrms/attendance/regularisations | ✓ `/v1/hrms/attendance/regularisations` | ✓ | ✅ WIRED |
| hr | /hr/dashboard | getHRDashboard | /api/v1/hrms/dashboard | hrms → /v1/hrms/dashboard | ✓ `/v1/hrms/dashboard` | ✓ | ✅ WIRED |
| hr | /hr/dashboard | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/dashboard | getJobOpenings | /api/v1/hrms/job-openings | hrms → /v1/hrms/job-openings | ✓ `/v1/hrms/job-openings` | ✓ | ✅ WIRED |
| hr | /hr/employees/[id] | getEmployeeById | /api/v1/hrms/employees/:param | hrms → /v1/hrms/employees/:param | ✓ `/v1/hrms/employees/:id` | ✓ | ✅ WIRED |
| hr | /hr/employees | getEmployees | /api/v1/hrms/employees | hrms → /v1/hrms/employees | ✓ `/v1/hrms/employees` | ✓ | ✅ WIRED |
| hr | /hr/leave/apply | — | — | — | — | — | — NO_LOADER |
| hr | /hr/leave | getLeaveRequestDetails | /api/v1/hrms/leave-requests | hrms → /v1/hrms/leave-requests | ✓ `/v1/hrms/leave-requests` | ✓ | ✅ WIRED |
| hr | /hr/orgchart | — | — | — | — | — | — NO_LOADER |
| hr | /hr | — | — | — | — | — | — NO_LOADER |
| hr | /hr/payroll/[id] | getPayrollRunById | /api/v1/payroll/runs/:param | payroll → /v1/payroll/runs/:param | ✓ `/v1/payroll/runs/:id` | ✓ | ✅ WIRED |
| hr | /hr/payroll | getPayrollRunDetails | /api/v1/payroll/runs | payroll → /v1/payroll/runs | ✓ `/v1/payroll/runs` | ✓ | ✅ WIRED |
| hr | /hr/payroll/salary-slips | getSalarySlips | /api/v1/payroll/salary-slips | payroll → /v1/payroll/salary-slips | ✓ `/v1/payroll/salary-slips` | ✓ | ✅ WIRED |
| hr | /hr/recruitment | getJobOpenings | /api/v1/hrms/job-openings | hrms → /v1/hrms/job-openings | ✓ `/v1/hrms/job-openings` | ✓ | ✅ WIRED |
| hr | /hr/training | getTrainingPrograms | /api/v1/hrms/training-programs | hrms → /v1/hrms/training-programs | ✓ `/v1/hrms/training-programs` | ✓ | ✅ WIRED |
| install | /install | getInstallSteps | /api/v1/install/steps | install → /v1/install/steps | ✓ `/v1/install/steps` | ✓ | ✅ WIRED |
| inventory | /inventory/list | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory | — | — | — | — | — | — NO_LOADER |
| inventory | /inventory/reconcile | getStockLedger | /api/v1/stock/ledger | stock → /v1/stock/ledger | ✓ `/v1/stock/ledger` | ✓ | ✅ WIRED |
| knowledge | /knowledge/dashboard | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/list | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge | — | — | — | — | — | — NO_LOADER |
| knowledge | /knowledge/records | getKnowledgeRecords | /api/v1/knowledge/records | knowledge → /v1/knowledge/records | ✓ `/v1/knowledge/records` | ✓ | ✅ WIRED |
| knowledge | /knowledge/repository | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| knowledge | /knowledge/search | getKnowledgeDocs | /api/v1/knowledge/documents | knowledge → /v1/knowledge/documents | ✓ `/v1/knowledge/documents` | ✓ | ✅ WIRED |
| legal | /legal/cases/[id] | getLegalCaseById | /api/v1/legal/cases/:param | legal → /v1/legal/cases/:param | ✓ `/v1/legal/cases/:id` | ✓ | ✅ WIRED |
| legal | /legal/court-orders | getCourtOrders | /api/v1/legal/court-orders | legal → /v1/legal/court-orders | ✓ `/v1/legal/court-orders` | ✓ | ✅ WIRED |
| legal | /legal/dashboard | getLegalDashboard | /api/v1/legal/dashboard | legal → /v1/legal/dashboard | ✓ `/v1/legal/dashboard` | ✓ | ✅ WIRED |
| legal | /legal/hearings | getLegalHearings | /api/v1/legal/hearings | legal → /v1/legal/hearings | ✓ `/v1/legal/hearings` | ✓ | ✅ WIRED |
| legal | /legal/list | getLegalCases | /api/v1/legal/cases | legal → /v1/legal/cases | ✓ `/v1/legal/cases` | ✓ | ✅ WIRED |
| legal | /legal/opinions | getLegalOpinions | /api/v1/legal/opinions | legal → /v1/legal/opinions | ✓ `/v1/legal/opinions` | ✓ | ✅ WIRED |
| legal | /legal | — | — | — | — | — | — NO_LOADER |
| locations | /locations/list | getLocations | /api/v1/locations | locations → /v1/locations/ | ✓ `/v1/locations` | ✓ | ✅ WIRED |
| locations | /locations | — | — | — | — | — | — NO_LOADER |
| notifications | /notifications/deliveries | getNotificationDeliveries | /api/notification/deliveries | notification → /notifications/deliveries | ✓ `/notifications/deliveries` | ✓ | ✅ WIRED |
| notifications | /notifications/list | getNotifications | /api/notification/notifications | notification → /notifications/notifications | ✓ `/notifications/notifications` | ✓ | ✅ WIRED |
| notifications | /notifications | — | — | — | — | — | — NO_LOADER |
| plugins | /plugins | getPlugins | /api/v1/plugins/items | plugin → /v1/plugins/items | ✓ `/v1/plugins/items` | ✓ | ✅ WIRED |
| procurement | /procurement/approvals | getProcurementApprovals | /api/v1/procurement/approvals | procurement → /v1/procurement/approvals | ✓ `/v1/procurement/approvals` | ✓ | ✅ WIRED |
| procurement | /procurement/contracts | getContracts | /api/v1/contract/contracts | contract → /v1/contract/contracts | ✓ `/v1/contract/contracts` | ✓ | ✅ WIRED |
| procurement | /procurement/dashboard | getProcurementDashboard | /api/v1/procurement/dashboard | procurement → /v1/procurement/dashboard | ✓ `/v1/procurement/dashboard` | ✓ | ✅ WIRED |
| procurement | /procurement/grn | getProcurementGRNs | /api/v1/procurement/grns | procurement → /v1/procurement/grns | ✓ `/v1/procurement/grns` | ✓ | ✅ WIRED |
| procurement | /procurement/indents/[id] | getProcurementIndentById | /api/v1/procurement/indents/:param | procurement → /v1/procurement/indents/:param | ✓ `/v1/procurement/indents/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/indents | getProcurementIndents | /api/v1/procurement/indents | procurement → /v1/procurement/indents | ✓ `/v1/procurement/indents` | ✓ | ✅ WIRED |
| procurement | /procurement/orders/[id] | getProcurementPOById | /api/v1/procurement/pos/:param | procurement → /v1/procurement/pos/:param | ✓ `/v1/procurement/pos/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/orders | getProcurementPOs | /api/v1/procurement/pos | procurement → /v1/procurement/pos | ✓ `/v1/procurement/pos` | ✓ | ✅ WIRED |
| procurement | /procurement | — | — | — | — | — | — NO_LOADER |
| procurement | /procurement/rfq/[id] | getRFQById | /api/v1/procurement/rfqs/:param | procurement → /v1/procurement/rfqs/:param | ✓ `/v1/procurement/rfqs/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/rfq | getRFQs | /api/v1/procurement/rfqs | procurement → /v1/procurement/rfqs | ✓ `/v1/procurement/rfqs` | ✓ | ✅ WIRED |
| procurement | /procurement/tenders/[id] | getProcurementTenderById | /api/v1/procurement/tenders/:param | procurement → /v1/procurement/tenders/:param | ✓ `/v1/procurement/tenders/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/tenders | getProcurementTenders | /api/v1/procurement/tenders | procurement → /v1/procurement/tenders | ✓ `/v1/procurement/tenders` | ✓ | ✅ WIRED |
| procurement | /procurement/vendors/[id] | getProcurementVendorById | /api/v1/procurement/vendors/:param | procurement → /v1/procurement/vendors/:param | ✓ `/v1/procurement/vendors/:id` | ✓ | ✅ WIRED |
| procurement | /procurement/vendors | getProcurementVendors | /api/v1/procurement/vendors | procurement → /v1/procurement/vendors | ✓ `/v1/procurement/vendors` | ✓ | ✅ WIRED |
| projects | /projects/[id] | getProjectById | /api/v1/project/projects/:param | project → /v1/projects/projects/:param | ✓ `/v1/projects/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getProjectsDashboard | /api/v1/project/dashboard | project → /v1/projects/dashboard | ✓ `/v1/projects/dashboard` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/dashboard | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/fund-releases | getProjectFundReleases | /api/v1/project/fund-releases | project → /v1/projects/fund-releases | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| projects | /projects/list | getProjects | /api/v1/project/projects | project → /v1/projects/projects | ✓ `/v1/projects/projects` | ✓ | ✅ WIRED |
| projects | /projects/milestones | getMilestones | /api/v1/project/milestones | project → /v1/projects/milestones | ✓ `/v1/projects/milestones` | ✓ | ✅ WIRED |
| projects | /projects | — | — | — | — | — | — NO_LOADER |
| projects | /projects/schemes | getSchemes | /api/v1/project/schemes | project → /v1/projects/schemes | ✓ `/v1/projects/:id` | ✓ | ✅ WIRED |
| reports | /reports/[id] | getReportJobById | /api/v1/reports/report-jobs/:param | reports → /v1/reports/report-jobs/:param | ✓ `/v1/reports/report-jobs/:id` | ✓ | ✅ WIRED |
| reports | /reports/dashboard | getReportsDashboard | /api/v1/reports/dashboards | reports → /v1/reports/dashboards | ✓ `/v1/reports/dashboards` | ✓ | ✅ WIRED |
| reports | /reports/kpi | getKPIs | /api/v1/reports/kpis | reports → /v1/reports/kpis | ✓ `/v1/reports/kpis` | ✓ | ✅ WIRED |
| reports | /reports/list | getReportJobs | /api/v1/reports/report-jobs | reports → /v1/reports/report-jobs | ✓ `/v1/reports/report-jobs` | ✓ | ✅ WIRED |
| reports | /reports/mis | getMISSummary | /api/v1/reports/mis | reports → /v1/reports/mis | ✓ `/v1/reports/mis` | ✓ | ✅ WIRED |
| reports | /reports | — | — | — | — | — | — NO_LOADER |
| stock | /stock/[id] | getStockItemById | /api/v1/stock/items/:param | stock → /v1/stock/items/:param | ✓ `/v1/stock/items/:id` | ✓ | ✅ WIRED |
| stock | /stock/dashboard | getStockDashboard | /api/v1/stock/dashboard | stock → /v1/stock/dashboard | ✓ `/v1/stock/dashboard` | ✓ | ✅ WIRED |
| stock | /stock/ledger | getStockLedger | /api/v1/stock/ledger | stock → /v1/stock/ledger | ✓ `/v1/stock/ledger` | ✓ | ✅ WIRED |
| stock | /stock/list | getStockItems | /api/v1/stock/items | stock → /v1/stock/items | ✓ `/v1/stock/items` | ✓ | ✅ WIRED |
| stock | /stock | — | — | — | — | — | — NO_LOADER |
| telephony | /telephony/list | getTelephonyCalls | /api/v1/telephony/calls | telephony → /v1/telephony/calls | ✓ `/v1/telephony/calls` | ✓ | ✅ WIRED |
| telephony | /telephony | — | — | — | — | — | — NO_LOADER |
| tenant-admin | /tenant-admin/api-keys | getAPIKeys | /api/v1/admin/api-keys | admin → /v1/admin/api-keys | ✓ `/v1/admin/api-keys` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/audit | getTenantAuditLog | /api/v1/audit/events | audit → /v1/audit/events | ✓ `/v1/audit/events` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/breakglass | getBreakglassLog | /api/v1/audit/breakglass | audit → /v1/audit/breakglass | ✓ `/v1/audit/breakglass` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/notifications | getNotificationPreferences | /api/notification/preferences | notification → /notifications/preferences | ✓ `/notifications/preferences` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin | getTenantAdminDashboard | /api/v1/admin/health | admin → /v1/admin/health | ✓ `/v1/admin/health` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles/[id] | getAdminRoleById | /api/policy/roles/:param | policy → /policy/roles/:param | ✓ `/policy/roles/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/roles | getAdminRoles | /api/policy/roles | policy → /policy/roles | ✓ `/policy/roles` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/sessions | getActiveSessions | /api/identity/sessions | identity → /identity/sessions | ✓ `/identity/sessions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/settings | getTenantModules | /api/v1/admin/tenant/modules | admin → /v1/admin/tenant/modules | ✓ `/v1/admin/tenant/modules` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/subscription | getSubscription | /api/v1/billing/subscriptions | billing → /v1/billing/subscriptions | ✓ `/v1/billing/subscriptions` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users/[id] | getAdminUserById | /api/identity/users/:param | identity → /identity/users/:param | ✓ `/identity/users/:id` | ✓ | ✅ WIRED |
| tenant-admin | /tenant-admin/users | getAdminUsers | /api/identity/users | identity → /identity/users | ✓ `/identity/users` | ✓ | ✅ WIRED |
| themes | /themes | getThemeTokens | /api/v1/themes/tokens | theme → /v1/themes/tokens | ✓ `/v1/themes/tokens` | ✓ | ✅ WIRED |
| workflow | /workflow/list | getWorkflowInstances | /api/v1/workflow/instances | workflow → /v1/workflow/instances | ✓ `/v1/workflow/instances` | ✓ | ✅ WIRED |
| workflow | /workflow | — | — | — | — | — | — NO_LOADER |
