#!/usr/bin/env node
/**
 * start-mock-gateway.mjs
 *
 * Minimal HTTP mock gateway for CI verify-screens gate.
 * Returns 200 JSON for all paths the verify-screens.mjs checks.
 * Designed to be started with `node scripts/ci/start-mock-gateway.mjs &`.
 *
 * Port: 8080 (matches verify-screens default)
 */
import http from 'node:http';

const PORT = process.env.MOCK_GATEWAY_PORT ?? 8080;

// Seed data mirrors apps/web/e2e/global-setup.ts so verify-screens sees non-empty rows
const FIXTURES = {
  '/health': { status: 'ok' },

  '/api/audit/events': [
    { id: 'a1', type: 'user.login', actor: { email: 'admin@example.com', name: 'Admin' }, severity: 'info', occurredAt: '2024-01-01T00:00:00Z', tenantId: 't1', target: null, payload: {} },
  ],

  '/api/v1/finance/accounts': { data: [{ code: '1001', name: 'Cash', type: 'asset', currency: 'INR', balanceDisplay: '5,000', status: 'active' }] },
  '/api/v1/finance/payments': { data: [{ referenceId: 'PAY-001', beneficiary: 'Tech Supplies Ltd', amountDisplay: '10,000', status: 'Queued' }], pagination: { hasMore: false, pageSize: 50 } },
  '/api/v1/finance/journals': [{ id: 'j1', voucherNo: 'JV-001', type: 'payment', postingDate: '2024-01-15', debitTotal: 47500, creditTotal: 47500, status: 'posted' }],
  '/api/v1/finance/dashboard': { budgetUtilisationPct: 75, pendingSanctions: 3, paymentsThisMonth: 12, totalExpenditure: 500000 },
  '/api/v1/finance/budgets': [{ id: 'b1', majorHead: '2055', sanctionedAmount: 4000000, releasedAmount: 5200000, expenditure: 3500000, balance: 500000, status: 'active', financialYear: '2024-25' }],
  '/api/v1/finance/sanctions': [{ id: 's1', sanctionNo: 'SAN/2024/001', subject: 'Office renovation', amount: 500000, sanctionedBy: 'Admin', date: '2024-01-10', status: 'approved', majorHead: '2055' }],
  '/api/v1/finance/bills': [{ id: 'bill1', billNo: 'BILL/2024/0001', vendor: 'Tech Supplies', amount: 50000, status: 'approved', dueDate: '2024-02-01' }],
  '/api/v1/finance/advances': [{ id: 'adv1', advanceNo: 'ADV/2024/001', purpose: 'Tour advance', amount: 25000, status: 'approved' }],
  '/api/v1/finance/statements': [{ id: 'stmt1', type: 'trial_balance', period: '2024-25', generatedAt: '2024-01-31T00:00:00Z' }],
  '/api/v1/finance/utilization-certificates': [{ id: 'uc1', ucNo: 'UC/2024/001', grantRef: 'GRANT-001', amount: 100000, status: 'submitted' }],

  '/api/v1/hrms/employees': { data: [{ id: 'EMP-001', name: 'Ravi Kumar', department: 'IT', status: 'Active' }], pagination: { hasMore: false, pageSize: 50 } },
  '/api/v1/hrms/leave-applications': { data: [] },
  '/api/v1/hrms/leave-requests': [{ id: 'lr1', employeeName: 'Ravi Kumar', leaveType: 'casual', fromDate: '2024-02-01', toDate: '2024-02-03', days: 3, status: 'pending' }],
  '/api/v1/hrms/attendance': [{ id: 'att1', employeeName: 'Ravi Kumar', date: '2024-01-15', status: 'present', checkIn: '09:00', checkOut: '18:00' }],
  '/api/v1/hrms/attendance/regularisations': [{ id: 'reg1', employeeName: 'Ravi Kumar', date: '2024-01-10', reason: 'Official duty', status: 'pending' }],
  '/api/v1/hrms/job-openings': [{ id: 'jo1', title: 'Senior Engineer', department: 'IT', vacancies: 2, status: 'open' }],
  '/api/v1/hrms/appraisals': [{ id: 'ap1', employeeName: 'Ravi Kumar', period: '2023-24', rating: 4, status: 'completed' }],
  '/api/v1/hrms/training-programs': [{ id: 'tr1', title: 'Cyber Security Awareness', startDate: '2024-03-01', status: 'scheduled' }],
  '/api/v1/hrms/dashboard': { headcount: 2, attendanceTodayPct: 95, pendingLeaves: 1, payrollDue: 0 },
  '/api/v1/hrms/org-chart': [{ id: 'emp1', name: 'Demo Admin', title: 'Director', children: [] }],

  '/api/v1/payroll/runs': { data: [] },
  '/api/v1/payroll/salary-slips': [{ id: 'ss1', employeeName: 'Ravi Kumar', month: '2024-01', grossPay: 85000, netPay: 72000, status: 'paid' }],

  '/api/v1/procurement/vendors': [{ id: 'v1', vendorCode: 'VEN-001', name: 'Tech Supplies Ltd', gstin: '29ABCDE1234F1Z5', category: 'IT', empanelmentStatus: 'empanelled', rating: 4.5, contactPerson: 'Rahul Sharma' }],
  '/api/v1/procurement/pos': { data: [] },
  '/api/v1/procurement/approvals': { data: [] },
  '/api/v1/procurement/dashboard': { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
  '/api/v1/procurement/indents': [{ id: 'ind1', indentNo: 'IND/2024/001', department: 'IT', amount: 50000, status: 'pending_approval' }],
  '/api/v1/procurement/rfqs': [{ id: 'rfq1', rfqNo: 'RFQ/2024/001', title: 'Laptop procurement', status: 'open' }],
  '/api/v1/procurement/grns': [{ id: 'grn1', grnNo: 'GRN/2024/001', poNo: 'PO/2024/001', status: 'accepted' }],
  '/api/v1/procurement/tenders': [{ id: 'ten1', tenderNo: 'TEN/2024/001', title: 'Road works', status: 'published' }],

  '/api/v1/crm/contacts': { data: [{ id: 'c1', name: 'Anita Desai', email: 'anita@example.com', phone: '+91-9876543210', company: 'GoI Dept', status: 'active' }], pagination: { hasMore: false, pageSize: 50 } },
  '/api/v1/crm/deals': { data: [], pagination: { hasMore: false, pageSize: 50 } },
  '/api/v1/crm/activities': { data: [], pagination: { hasMore: false, pageSize: 50 } },
  '/api/v1/crm/dashboard': { totalContacts: 1, openDeals: 0, activitiesToday: 0, pipelineValue: 0 },

  '/api/v1/citizen/tickets': [{ id: 't1', ticketNo: 'TKT-001', subject: 'Portal access issue', requesterName: 'Ravi Shankar', priority: 'high', slaStatus: 'within_sla', status: 'open', channel: 'web', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', comments: [] }],
  '/api/v1/citizen/analytics/sla-rules': { data: [{ queue: 'General', targetDisplay: '4 hours', breachedCount: 0 }] },
  '/api/v1/citizen/analytics/metrics': { data: [{ label: 'Total Tickets', value: '1', note: 'This month' }] },
  '/api/v1/citizen/requests': [{ id: 'req-001', requestNo: 'REQ-001', serviceType: 'Birth Certificate', citizenName: 'Ramesh Kumar', phone: '+91-9876543210', submittedAt: '2024-01-01T00:00:00Z', expectedResolution: '2024-01-08', status: 'submitted' }],
  '/api/v1/citizen/rti': [{ id: 'rti-001', rtiNo: 'RTI-001', subject: 'Budget Expenditure Details FY 2024', applicantName: 'Priya Sharma', filedDate: '2024-01-01', deadlineDate: '2024-01-31', status: 'received' }],
  '/api/v1/helpdesk/tickets': { data: [], pagination: { hasMore: false, pageSize: 50 } },

  '/api/identity/users': [{ id: 'u1', tenantId: 't1', email: 'admin@example.com', name: 'Admin User', empCode: null, status: 'active', mfaEnabled: true, version: 1, roles: ['admin'], lastLoginAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' }],
  '/api/identity/sessions': [{ id: 'sess1', userId: 'u1', device: 'Chrome', ip: '127.0.0.1', status: 'active', startedAt: '2024-01-01T00:00:00Z' }],

  '/api/policy/roles': [{ id: 'r1', tenantId: 't1', name: 'admin', description: 'System administrator', status: 'active', version: 1, isSystemRole: true, userCount: 1, createdAt: '2024-01-01T00:00:00Z' }],

  '/api/v1/admin/tenant/modules': { data: [{ name: 'finance' }, { name: 'hr' }, { name: 'procurement' }] },
  '/api/v1/admin/health': { status: 'ok', services: [{ service: 'finance-service', status: 'ok' }] },
  '/api/v1/admin/health/readiness': { overall: 95, productionReady: true, allGreen: true },
  '/api/v1/admin/api-keys': [{ id: 'ak1', keyName: 'Integration Key', keyPrefix: 'civ_live', createdBy: 'Admin', createdAt: '2024-01-01T00:00:00Z', status: 'active', scopes: ['read'] }],
  '/api/v1/admin/breakglass': [{ id: 'bg1', actor: 'Admin', actorEmail: 'admin@demo.gov.in', reason: 'Emergency access', startedAt: '2024-01-01T00:00:00Z', status: 'ended' }],

  '/api/v1/billing/subscriptions': { id: 'sub1', planName: 'Govt Dept Standard', status: 'active', billingCycle: 'annual', amount: 0 },
  '/api/v1/billing/plans': [{ id: 'pl1', name: 'Govt Dept Standard', priceMonthly: 0, status: 'active' }],

  '/api/v1/audit/dashboard': { openObservations: 0, riskRegisterItems: 0, cagParas: 0, compliancePct: 0 },
  '/api/v1/audit/observations': [{ id: 'obs1', observationNo: 'OBS-001', title: 'Weak access controls', severity: 'high', status: 'open' }],
  '/api/v1/audit/risks': [{ id: 'risk1', riskId: 'RISK-001', title: 'Data breach risk', likelihood: 'medium', impact: 'high', status: 'open' }],
  '/api/v1/audit/plan': [{ id: 'plan1', auditYear: '2024-25', entity: 'Finance Dept', status: 'in_progress' }],
  '/api/v1/audit/compliance': [{ id: 'comp1', requirement: 'RTI compliance', status: 'pending', dueDate: '2024-03-31' }],
  '/api/v1/audit/exports': [{ id: 'exp1', jobType: '2024-01-export', requestedBy: 'Admin', format: 'pdf', status: 'completed' }],

  '/api/v1/project/dashboard': { totalProjects: 1, onTrackPct: 100, delayed: 0, totalOutlay: 500000000 },
  '/api/v1/project/projects': [{ id: 'prj-001', code: 'PROJ-001', name: 'Highway Expansion Phase 1', scheme: 'PMGSY', department: 'Roads & Transport', startDate: '2024-01-01', budget: 500000000, expenditure: 200000000, completionPct: 40, status: 'on_track' }],
  '/api/v1/project/milestones': [{ id: 'ms1', projectCode: 'PROJ-001', title: 'Phase 1 complete', dueDate: '2024-06-30', status: 'pending' }],
  '/api/v1/project/fund-releases': [{ id: 'fr1', projectCode: 'PROJ-001', amount: 50000000, releaseDate: '2024-01-15', status: 'released' }],
  '/api/v1/project/schemes': [{ id: 'sch1', schemeCode: 'PMGSY', name: 'PM Gram Sadak Yojana', ministry: 'Rural Dev', status: 'active' }],

  '/api/v1/grants/dashboard': { totalGrants: 1, disbursedAmount: 25000000, pendingUCs: 0, totalGrantees: 1 },
  '/api/v1/grants/grants': [{ id: 'grn-001', grantNo: 'GRANT-001', title: 'Rural Water Supply Scheme', grantee: 'Rajasthan State Govt', totalAmount: 50000000, disbursedAmount: 25000000, pendingAmount: 25000000, sanctionDate: '2024-01-15', status: 'active' }],
  '/api/v1/grants/grantees': [{ id: 'gtee1', name: 'Rajasthan State Govt', type: 'state', status: 'active' }],
  '/api/v1/grants/installments': [{ id: 'inst1', grantNo: 'GRANT-001', installmentNo: 1, amount: 25000000, status: 'released' }],
  '/api/v1/grants/releases': [{ id: 'rel1', grantNo: 'GRANT-001', amount: 25000000, releaseDate: '2024-01-20', status: 'processed' }],
  '/api/v1/grants/utilization-certs': [{ id: 'uc1', grantNo: 'GRANT-001', period: 'Q1', amount: 10000000, status: 'submitted' }],
  '/api/v1/grants/schemes': [],

  '/api/v1/estab/dashboard': { filesPending: 1, meetingsToday: 1, vehiclesInUse: 0, complianceItemsDue: 0 },
  '/api/v1/estab/files': [{ id: 'fil-001', fileNo: 'FILE-001', subject: 'Annual Budget Proposal 2024', classification: 'confidential', department: 'Finance', createdBy: 'Admin User', createdDate: '2024-01-10', currentHolder: 'Director Finance', status: 'active' }],
  '/api/v1/estab/meetings': [{ id: 'mtg-001', meetingNo: 'MTG-001', title: 'Quarterly Review Board Meeting', type: 'review', scheduledDate: '2024-02-15', scheduledTime: '10:00', venue: 'Conference Room A', chairperson: 'Secretary', attendeesCount: 12, agendaItemsCount: 0, status: 'scheduled' }],
  '/api/v1/estab/vehicles': [{ id: 'veh1', registrationNo: 'DL-01-AB-1234', make: 'Toyota', model: 'Innova', status: 'available' }],
  '/api/v1/estab/guesthouse-bookings': [{ id: 'gb1', guestName: 'Official Guest', roomNo: '101', checkIn: '2024-02-01', status: 'confirmed' }],
  '/api/v1/estab/compliance': [{ id: 'ec1', item: 'Fire safety audit', frequency: 'annual', status: 'pending', dueDate: '2024-06-30' }],

  '/api/v1/asset/dashboard': { totalAssets: 1, underMaintenance: 0, dueForDisposal: 0, netBlock: 7200000 },
  '/api/v1/asset/assets': [{ id: 'ast-001', assetCode: 'AST-001', name: 'Dell Laptop XPS 15', category: 'IT Equipment', type: 'fixed', purchaseDate: '2023-01-15', purchaseCost: 8500000, currentValue: 7200000, location: 'HQ Block A', department: 'IT', status: 'active' }],
  '/api/v1/asset/maintenance': [{ id: 'mnt-001', assetCode: 'AST-001', assetName: 'Dell Laptop XPS 15', maintenanceType: 'preventive', scheduledDate: '2024-03-01', completedDate: null, vendor: 'Dell India Services', estimatedCost: 500000, actualCost: null, status: 'scheduled' }],

  '/api/v1/stock/dashboard': { totalSKUs: 1, lowStockAlerts: 0, grnsThisMonth: 3, inventoryValue: 3000000 },
  '/api/v1/stock/items': [{ id: 'sku-001', itemCode: 'SKU-001', name: 'A4 Paper Ream', category: 'Stationery', unit: 'Ream', currentStock: 200, minLevel: 50, unitCost: 15000, totalValue: 3000000, warehouse: 'Main Store', isLowStock: false, status: 'active' }],
  '/api/v1/stock/ledger': [{ id: 'led-001', itemCode: 'SKU-001', itemName: 'A4 Paper Ream', type: 'receipt', quantity: 200, unitCost: 15000, totalValue: 3000000, warehouse: 'Main Store', reference: 'GRN-001', date: '2024-01-10' }],

  '/api/v1/legal/cases': [{ id: 'leg-001', caseNo: 'CASE-001', title: 'State v. ABC Construction Ltd', court: 'High Court Delhi', type: 'civil', filedDate: '2023-06-01', department: 'Works', petitioner: 'State of Delhi', respondent: 'ABC Construction Ltd', counsel: 'Adv. Rajesh Kumar', nextHearingDate: '2024-03-15', status: 'active' }],
  '/api/v1/legal/hearings': [{ id: 'h1', caseNo: 'CASE-001', hearingDate: '2024-03-15', court: 'High Court Delhi', status: 'scheduled' }],
  '/api/v1/legal/court-orders': [{ id: 'co1', orderNo: 'ORD-001', caseNo: 'CASE-001', orderDate: '2024-01-20', status: 'pending' }],
  '/api/v1/legal/opinions': [{ id: 'op1', subject: 'Contract validity', requestedBy: 'Finance Dept', status: 'draft', dueDate: '2024-02-28' }],
  '/api/v1/legal/dashboard': { activeCases: 1, hearingsThisWeek: 0, ordersPending: 0, opinionsDue: 0 },

  '/api/v1/knowledge/documents': [{ id: 'doc-001', docId: 'DOC-001', title: 'Procurement Policy 2024', category: 'Policy', author: 'Admin', version: '1.0', createdAt: '2024-01-01T00:00:00Z', tags: 'procurement,policy', accessLevel: 'public' }],
  '/api/v1/knowledge/records': [{ id: 'rec1', recordNo: 'REC-001', title: 'Policy Archive 2023', category: 'Archive', status: 'approved' }],
  '/api/v1/workflow/instances': [{ id: 'wf1', workflowName: 'Leave Approval', status: 'running', startedAt: '2024-01-01T00:00:00Z' }],
  '/api/v1/analytics/dashboards': [{ id: 'ad1', name: 'Finance KPI Dashboard', module: 'finance', status: 'active' }],
  '/api/v1/locations': [{ id: 'loc1', name: 'HQ Delhi', type: 'office', status: 'active' }],
  '/api/notification/preferences': [{ id: 'pref1', eventType: 'bill.approved', module: 'finance', label: 'Bill Approved', emailEnabled: true, inAppEnabled: true }],
  '/api/v1/contract/contracts': [{ id: 'con1', contractNo: 'CON/2024/001', title: 'Annual AMC', vendor: 'Tech Corp', status: 'active' }],
  '/api/v1/reports/mis': [{ id: 'mis1', module: 'finance', metric: 'Budget Utilization', value: 75, period: 'Q1' }],
  '/api/v1/plugins/items': [{ id: 'pg1', name: 'PFMS Connector', status: 'active' }],
  '/api/v1/themes/tokens': [{ id: 'th1', name: 'Govt Blue', status: 'active' }],
  '/api/v1/telephony/calls': [{ id: 'call1', caller: '+91-9876543210', duration: 120, status: 'completed' }],
  '/api/notification/notifications': [{ id: 'n1', title: 'Bill Approved', message: 'Bill BILL/2024/0001 approved', status: 'sent', createdAt: '2024-01-01T00:00:00Z' }],
  '/api/notification/deliveries': [{ id: 'd1', recipient: 'finance@demo.gov.in', channel: 'email', status: 'delivered', sentAt: '2024-01-01T00:00:00Z' }],
  '/api/v1/audit/events': [{ id: 'ae1', type: 'user.login', actor: { email: 'admin@example.com', name: 'Admin' }, severity: 'info', occurredAt: '2024-01-01T00:00:00Z', tenantId: 't1', target: null, payload: {} }],
  '/api/v1/devices/register': { trustToken: 'test-trust-token' },

  '/api/v1/reports/dashboard': { kpis: [{ label: 'Reports Generated', value: '1', note: 'This month' }] },
  '/api/v1/reports/dashboards': { kpis: [{ label: 'Reports Generated', value: '1', note: 'This month' }] },
  '/api/v1/reports/jobs': [{ id: 'rpt-001', reportName: 'Monthly Finance Summary', module: 'finance', requestedBy: 'Admin User', requestedAt: '2024-01-31T10:00:00Z', completedAt: '2024-01-31T10:05:00Z', format: 'PDF', rows: 250, status: 'completed' }],
  '/api/v1/reports/report-jobs': [{ id: 'rpt-001', reportName: 'Monthly Finance Summary', module: 'finance', requestedBy: 'Admin User', requestedAt: '2024-01-31T10:00:00Z', completedAt: '2024-01-31T10:05:00Z', format: 'PDF', rows: 250, status: 'completed' }],
  '/api/v1/reports/kpis': [{ id: 'kpi-001', name: 'Budget Utilization Rate', ownerModule: 'finance', target: 80, actual: 75, unit: '%', achievementPct: 93.75, period: 'Q1 FY2024', trend: 'up' }],
  '/api/v1/reports/mis': [{ id: 'mis1', module: 'finance', metric: 'Budget Utilization', value: 75, period: 'Q1' }],
  '/api/v1/install/steps': [{ id: 'step1', stepNo: 1, title: 'Database Setup', status: 'completed' }],
};

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const body = path in FIXTURES ? FIXTURES[path] : { data: [] };
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`[mock-gateway] listening on http://0.0.0.0:${PORT}\n`);
});

// Keep alive until killed
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
