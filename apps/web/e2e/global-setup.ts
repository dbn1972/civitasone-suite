import http from 'node:http';
import type { FullConfig } from '@playwright/test';

const PORT = 4001;

const PAGINATION = { hasMore: false, pageSize: 50 };

// Fixtures keyed by path (query strings stripped at request time)
const FIXTURES: Record<string, unknown> = {
  // Audit trail — auditEventsListSchema expects array of auditEventApiSchema objects
  '/api/audit/events': [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      tenantId: 'a0000000-0000-0000-0000-000000000002',
      type: 'user.login',
      actor: { email: 'admin@example.com', name: 'Admin' },
      target: null,
      payload: {},
      severity: 'info',
      occurredAt: '2024-01-01T00:00:00Z',
    },
  ],

  // Finance — chart of accounts has no responseSchema, just mapAccounts
  '/api/v1/finance/accounts': {
    data: [
      { code: '1001', name: 'Cash', type: 'asset', currency: 'INR', balanceDisplay: '5,000', status: 'active' },
      { code: '2001', name: 'Accounts Payable', type: 'liability', currency: 'INR', balanceDisplay: '2,000', status: 'active' },
    ],
  },

  // Finance payments — paymentsListSchema = paginatedSchema(paymentSummarySchema)
  '/api/v1/finance/payments': {
    data: [{ referenceId: 'PAY-001', beneficiary: 'Tech Supplies Ltd', amountDisplay: '10,000', status: 'Queued' }],
    pagination: PAGINATION,
  },

  // Finance GL journals
  '/api/v1/finance/journals': [],

  '/api/v1/finance/dashboard': {
    budgetUtilisationPct: 75,
    pendingSanctions: 3,
    paymentsThisMonth: 12,
    totalExpenditure: 500000,
  },

  '/api/v1/finance/budgets': [],
  '/api/v1/finance/sanctions': [],
  '/api/v1/finance/bills': [],
  '/api/v1/finance/advances': [],
  '/api/v1/finance/statements': [],
  '/api/v1/finance/utilization-certificates': [],

  // HR employees — employeesListSchema = paginatedSchema(employeeSummarySchema)
  '/api/v1/hrms/employees': {
    data: [
      { id: 'EMP-001', name: 'Ravi Kumar', department: 'IT', status: 'Active' },
      { id: 'EMP-002', name: 'Priya Singh', department: 'Finance', status: 'Active' },
    ],
    pagination: PAGINATION,
  },

  '/api/v1/hrms/leave-applications': { data: [] },
  '/api/v1/hrms/leave-requests': [],
  '/api/v1/hrms/attendance/summary': { data: [] },
  '/api/v1/hrms/attendance': [],
  '/api/v1/hrms/attendance/regularisations': [],
  '/api/v1/hrms/dashboard': { headcount: 2, attendanceTodayPct: 95, pendingLeaves: 0, payrollDue: 0 },
  '/api/v1/hrms/job-openings': [],
  '/api/v1/hrms/appraisals': [],
  '/api/v1/hrms/training-programs': [],
  '/api/v1/hrms/org-chart': [],

  '/api/v1/payroll/runs': { data: [] },
  '/api/v1/payroll/salary-slips': [],

  // Procurement vendors — VendorDetailListSchema = z.array(VendorDetailSchema)
  '/api/v1/procurement/vendors': [
    {
      id: 'v0000000-0000-0000-0000-000000000001',
      vendorCode: 'VEN-001',
      name: 'Tech Supplies Ltd',
      gstin: '29ABCDE1234F1Z5',
      category: 'IT',
      empanelmentStatus: 'empanelled',
      rating: 4.5,
      contactPerson: 'Rahul Sharma',
    },
  ],

  '/api/v1/procurement/pos': { data: [] },
  '/api/v1/procurement/approvals': { data: [] },
  '/api/v1/procurement/dashboard': { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
  '/api/v1/procurement/indents': [],
  '/api/v1/procurement/rfqs': [],
  '/api/v1/procurement/grns': [],
  '/api/v1/procurement/tenders': [],

  // CRM contacts — crmContactsListSchema = paginatedSchema(crmContactApiSchema)
  '/api/v1/crm/contacts': {
    data: [
      {
        id: 'c0000000-0000-0000-0000-000000000001',
        name: 'Anita Desai',
        email: 'anita@example.com',
        phone: '+91-9876543210',
        company: 'GoI Dept',
        status: 'active',
      },
    ],
    pagination: PAGINATION,
  },

  '/api/v1/crm/deals': { data: [], pagination: PAGINATION },
  '/api/v1/crm/activities': { data: [], pagination: PAGINATION },
  '/api/v1/crm/dashboard': { totalContacts: 1, openDeals: 0, activitiesToday: 0, pipelineValue: 0 },

  // Citizen / helpdesk tickets — TicketDetailListSchema = z.array(TicketDetailSchema)
  '/api/v1/citizen/tickets': [
    {
      id: 't0000000-0000-0000-0000-000000000001',
      ticketNo: 'TKT-001',
      subject: 'Unable to access portal',
      requesterName: 'Ravi Shankar',
      priority: 'high',
      slaStatus: 'within_sla',
      status: 'open',
      channel: 'web',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      comments: [],
    },
  ],

  '/api/v1/citizen/analytics/sla-rules': {
    data: [{ queue: 'General', targetDisplay: '4 hours', breachedCount: 0 }],
  },
  '/api/v1/citizen/analytics/metrics': {
    data: [{ label: 'Total Tickets', value: '1', note: 'This month' }],
  },
  '/api/v1/citizen/requests': [
    {
      id: 'req-001',
      requestNo: 'REQ-001',
      serviceType: 'Birth Certificate',
      citizenName: 'Ramesh Kumar',
      phone: '+91-9876543210',
      submittedAt: '2024-01-01T00:00:00Z',
      expectedResolution: '2024-01-08',
      status: 'submitted',
    },
  ],
  '/api/v1/citizen/rti': [
    {
      id: 'rti-001',
      rtiNo: 'RTI-001',
      subject: 'Budget Expenditure Details FY 2024',
      applicantName: 'Priya Sharma',
      filedDate: '2024-01-01',
      deadlineDate: '2024-01-31',
      status: 'received',
    },
  ],
  '/api/v1/helpdesk/tickets': { data: [], pagination: PAGINATION },

  // Identity / tenant admin — satisfies both AdminUserSummaryListSchema and userListResponseSchema
  '/api/identity/users': [
    {
      id: 'u0000000-0000-0000-0000-000000000001',
      tenantId: 't0000000-0000-0000-0000-000000000001',
      email: 'admin@example.com',
      name: 'Admin User',
      empCode: null,
      status: 'active',
      mfaEnabled: true,
      version: 1,
      roles: ['admin'],
      lastLoginAt: '2024-01-01T00:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    },
  ],

  '/api/identity/sessions': [],

  // Policy roles — satisfies both AdminRoleSummaryListSchema and roleListResponseSchema
  '/api/policy/roles': [
    {
      id: 'r0000000-0000-0000-0000-000000000001',
      tenantId: 't0000000-0000-0000-0000-000000000001',
      name: 'admin',
      description: 'System administrator',
      status: 'active',
      version: 1,
      isSystemRole: true,
      userCount: 1,
      createdAt: '2024-01-01T00:00:00Z',
    },
  ],

  // Admin — tenantModulesResponseSchema = dataListSchema(tenantSettingSchema)
  '/api/v1/admin/tenant/modules': {
    data: [{ name: 'finance' }, { name: 'hr' }, { name: 'procurement' }],
  },
  '/api/v1/admin/health': { status: 'ok', services: [{ service: 'finance-service', status: 'ok' }] },
  '/api/v1/admin/health/readiness': { overall: 95, productionReady: true, allGreen: true },
  '/api/v1/admin/api-keys': [],

  // Billing / subscription
  '/api/v1/billing/subscriptions': null,
  '/api/v1/billing/plans': [],

  // Other modules — empty arrays for unlisted routes
  '/api/v1/audit/dashboard': { openObservations: 0, riskRegisterItems: 0, cagParas: 0, compliancePct: 0 },
  '/api/v1/audit/observations': [],
  '/api/v1/audit/risks': [],
  '/api/v1/audit/plan': [],
  '/api/v1/audit/compliance': [],
  '/api/v1/audit/exports': [],
  '/api/v1/audit/breakglass': [],

  '/api/v1/project/dashboard': { totalProjects: 1, onTrackPct: 100, delayed: 0, totalOutlay: 500000000 },
  '/api/v1/project/projects': [
    {
      id: 'prj-001',
      code: 'PROJ-001',
      name: 'Highway Expansion Phase 1',
      scheme: 'PMGSY',
      department: 'Roads & Transport',
      startDate: '2024-01-01',
      budget: 500000000,
      expenditure: 200000000,
      completionPct: 40,
      status: 'on_track',
    },
  ],
  '/api/v1/project/milestones': [],
  '/api/v1/project/fund-releases': [],
  '/api/v1/project/schemes': [],

  '/api/v1/grants/dashboard': { totalGrants: 1, disbursedAmount: 25000000, pendingUCs: 0, totalGrantees: 1 },
  '/api/v1/grants/grants': [
    {
      id: 'grn-001',
      grantNo: 'GRANT-001',
      title: 'Rural Water Supply Scheme',
      grantee: 'Rajasthan State Govt',
      totalAmount: 50000000,
      disbursedAmount: 25000000,
      pendingAmount: 25000000,
      sanctionDate: '2024-01-15',
      status: 'active',
    },
  ],
  '/api/v1/grants/grantees': [],
  '/api/v1/grants/installments': [],
  '/api/v1/grants/releases': [],
  '/api/v1/grants/utilization-certs': [],
  '/api/v1/grants/schemes': [],

  '/api/v1/estab/dashboard': { filesPending: 1, meetingsToday: 1, vehiclesInUse: 0, complianceItemsDue: 0 },
  '/api/v1/estab/files': [
    {
      id: 'fil-001',
      fileNo: 'FILE-001',
      subject: 'Annual Budget Proposal 2024',
      classification: 'confidential',
      department: 'Finance',
      createdBy: 'Admin User',
      createdDate: '2024-01-10',
      currentHolder: 'Director Finance',
      status: 'active',
    },
  ],
  '/api/v1/estab/meetings': [
    {
      id: 'mtg-001',
      meetingNo: 'MTG-001',
      title: 'Quarterly Review Board Meeting',
      type: 'review',
      scheduledDate: '2024-02-15',
      scheduledTime: '10:00',
      venue: 'Conference Room A',
      chairperson: 'Secretary',
      attendeesCount: 12,
      status: 'scheduled',
    },
  ],
  '/api/v1/estab/vehicles': [],
  '/api/v1/estab/guesthouse-bookings': [],
  '/api/v1/estab/compliance': [],

  '/api/v1/asset/dashboard': { totalAssets: 1, underMaintenance: 0, dueForDisposal: 0, netBlock: 7200000 },
  '/api/v1/asset/assets': [
    {
      id: 'ast-001',
      assetCode: 'AST-001',
      name: 'Dell Laptop XPS 15',
      category: 'IT Equipment',
      type: 'fixed',
      purchaseDate: '2023-01-15',
      purchaseCost: 8500000,
      currentValue: 7200000,
      location: 'HQ Block A',
      department: 'IT',
      status: 'active',
    },
  ],
  '/api/v1/asset/maintenance': [
    {
      id: 'mnt-001',
      assetCode: 'AST-001',
      assetName: 'Dell Laptop XPS 15',
      maintenanceType: 'preventive',
      scheduledDate: '2024-03-01',
      completedDate: null,
      vendor: 'Dell India Services',
      estimatedCost: 500000,
      actualCost: null,
      status: 'scheduled',
    },
  ],

  '/api/v1/stock/dashboard': { totalSKUs: 1, lowStockAlerts: 0, grnsThisMonth: 3, inventoryValue: 3000000 },
  '/api/v1/stock/items': [
    {
      id: 'sku-001',
      itemCode: 'SKU-001',
      name: 'A4 Paper Ream',
      category: 'Stationery',
      unit: 'Ream',
      currentStock: 200,
      minLevel: 50,
      unitCost: 15000,
      totalValue: 3000000,
      warehouse: 'Main Store',
      isLowStock: false,
      status: 'active',
    },
  ],
  '/api/v1/stock/ledger': [
    {
      id: 'led-001',
      itemCode: 'SKU-001',
      itemName: 'A4 Paper Ream',
      type: 'receipt',
      quantity: 200,
      unitCost: 15000,
      totalValue: 3000000,
      warehouse: 'Main Store',
      reference: 'GRN-001',
      date: '2024-01-10',
    },
  ],

  '/api/v1/legal/cases': [
    {
      id: 'leg-001',
      caseNo: 'CASE-001',
      title: 'State v. ABC Construction Ltd',
      court: 'High Court Delhi',
      type: 'civil',
      filedDate: '2023-06-01',
      department: 'Works',
      petitioner: 'State of Delhi',
      respondent: 'ABC Construction Ltd',
      counsel: 'Adv. Rajesh Kumar',
      nextHearingDate: '2024-03-15',
      status: 'active',
    },
  ],
  '/api/v1/legal/hearings': [],
  '/api/v1/legal/court-orders': [],
  '/api/v1/legal/opinions': [],
  '/api/v1/legal/dashboard': { activeCases: 1, hearingsThisWeek: 0, ordersPending: 0, opinionsDue: 0 },

  '/api/v1/knowledge/documents': [
    {
      id: 'doc-001',
      docId: 'DOC-001',
      title: 'Procurement Policy 2024',
      category: 'Policy',
      author: 'Admin',
      version: '1.0',
      createdAt: '2024-01-01T00:00:00Z',
      tags: 'procurement,policy',
      accessLevel: 'public',
    },
  ],
  '/api/v1/knowledge/records': [],

  '/api/v1/workflow/instances': [],
  '/api/v1/analytics/dashboards': [],
  '/api/v1/inventory/items': [],
  '/api/v1/telephony/calls': [],
  '/api/v1/locations': [],
  '/api/notification/templates': [],
  '/api/notification/preferences': [],
  '/api/v1/install/stages': [],
  '/api/v1/plugins/items': [],
  '/api/v1/themes/tokens': [],
  '/api/v1/contract/contracts': [],
  '/api/v1/contract/rate-contracts': [],
  '/api/v1/devices/register': { trustToken: 'test-trust-token' },

  '/api/v1/reports/dashboard': { kpis: [] },
  '/api/v1/reports/jobs': [
    {
      id: 'rpt-001',
      reportName: 'Monthly Finance Summary',
      module: 'finance',
      requestedBy: 'Admin User',
      requestedAt: '2024-01-31T10:00:00Z',
      completedAt: '2024-01-31T10:05:00Z',
      format: 'PDF',
      rows: 250,
      status: 'completed',
    },
  ],
  '/api/v1/reports/kpis': [
    {
      id: 'kpi-001',
      name: 'Budget Utilization Rate',
      ownerModule: 'finance',
      target: 80,
      actual: 75,
      unit: '%',
      achievementPct: 93.75,
      period: 'Q1 FY2024',
      trend: 'up',
    },
  ],
  '/api/v1/reports/mis': [],
};

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = (req.url ?? '/').split('?')[0];
  const body = path in FIXTURES ? FIXTURES[path] : { data: [] };
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  // Expose server to globalTeardown via shared global
  (global as Record<string, unknown>).__e2eMockServer = server;
  console.log(`[e2e] Mock gateway listening on http://127.0.0.1:${PORT}`);
}
