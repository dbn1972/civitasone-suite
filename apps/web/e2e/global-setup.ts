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
  '/api/v1/hrms/attendance': [
    { id: 'att-001', employeeId: 'emp-001', employeeName: 'Ravi Kumar', date: '2024-07-15', status: 'present', department: 'IT', checkIn: '09:00', checkOut: '18:00', hoursWorked: 9 },
    { id: 'att-002', employeeId: 'emp-002', employeeName: 'Priya Singh', date: '2024-07-15', status: 'present', department: 'Finance', checkIn: '09:15', checkOut: '17:45', hoursWorked: 8.5 },
    { id: 'att-003', employeeId: 'emp-003', employeeName: 'Ankit Verma', date: '2024-07-15', status: 'absent', department: 'HR', hoursWorked: 0 },
    { id: 'att-004', employeeId: 'emp-004', employeeName: 'Meera Patel', date: '2024-07-15', status: 'on_leave', department: 'Legal', hoursWorked: 0 },
  ],
  '/api/v1/hrms/attendance/regularisations': [
    { id: 'reg-001', employeeId: 'emp-003', employeeName: 'Ankit Verma', date: '2024-07-10', requestedStatus: 'present', reason: 'Was on field duty', requestedAt: '2024-07-11T09:00:00Z', status: 'pending' },
  ],
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
      id: 'eeeeeeee-0001-0000-0000-000000000001',
      vendorCode: 'VEN-BEL-001',
      name: 'Bharat Electronics',
      gstin: '27AABCB1234F1Z5',
      category: 'Electronics',
      empanelmentStatus: 'empanelled',
      rating: 4.8,
      contactPerson: 'Suresh Babu',
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
      citizenPhone: '+91-9876543210',
      submittedAt: '2024-01-01T00:00:00Z',
      expectedResolutionDate: '2024-01-08',
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
  '/api/v1/admin/operations': {
    checkedAt: '2024-01-01T00:00:00.000Z',
    pm2Available: true,
    summary: { totalProcesses: 3, onlineProcesses: 3, workersOnline: 1, workersTotal: 1, failedJobs: 0, outboxPending: 0, queueHealthy: true },
    processes: [
      { name: 'admin', kind: 'service', status: 'online', restarts: 0, cpuPct: 1, memoryMb: 80, uptimeSeconds: 7200 },
      { name: 'gateway', kind: 'infrastructure', status: 'online', restarts: 0, cpuPct: 2, memoryMb: 90, uptimeSeconds: 7200 },
      { name: 'admin-worker', kind: 'worker', status: 'online', restarts: 0, cpuPct: 1, memoryMb: 64, uptimeSeconds: 3600 },
    ],
    queue: { healthy: true, detail: 'queue health check passed' },
    schedulers: [{ name: 'Admin break-glass auto-close', ownerProcess: 'admin-worker', schedule: 'Every 60 seconds', status: 'online' }],
    outbox: { pending: 0 },
    recentErrors: [],
    externalMonitorRecommendation: [{ tool: 'Uptime Kuma', purpose: 'External uptime checks for web, gateway, and /ready endpoints' }],
  },
  '/api/v1/admin/api-keys': [],

  // Billing / subscription
  '/api/v1/billing/subscriptions': null,
  '/api/v1/billing/plans': [{ id: 'PLN-001', label: 'Basic Plan', sublabel: 'Up to 10 users', status: 'active', meta: 'INR 999/mo' }],

  // Other modules — empty arrays for unlisted routes
  '/api/v1/audit/dashboard': { openObservations: 0, riskRegisterItems: 0, cagParas: 0, compliancePct: 0 },
  '/api/v1/audit/risks': [],
  '/api/v1/audit/plan': [],
  '/api/v1/audit/compliance': [],
  '/api/v1/audit/exports': [],
  '/api/v1/audit/breakglass': [],

  '/api/v1/project/dashboard': { totalProjects: 1, onTrackPct: 100, delayed: 0, totalOutlay: 500000000 },
  '/api/v1/project/projects': [
    {
      id: 'prj-001',
      projectCode: 'PROJ-001',
      name: 'Highway Expansion Phase 1',
      scheme: 'PMGSY',
      department: 'Roads & Transport',
      startDate: '2024-01-01',
      totalBudget: 50000000000,
      expenditure: 20000000000,
      completionPct: 40,
      status: 'active',
    },
  ],
  '/api/v1/project/milestones': [
    {
      id: 'ms-001',
      projectId: 'prj-001',
      projectName: 'Highway Expansion Phase 1',
      title: 'Land Acquisition',
      dueDate: '2024-03-31',
      completedDate: '2024-03-15',
      status: 'completed',
    },
  ],
  '/api/v1/project/fund-releases': [],
  '/api/v1/project/schemes': [
    {
      id: 'sch-001',
      schemeCode: 'PMGSY-2024',
      name: 'Pradhan Mantri Gram Sadak Yojana',
      ministry: 'Rural Development',
      fundingType: 'centrally_sponsored',
      totalAllocation: 10000000000,
      releasedAmount: 5000000000,
      projectCount: 15,
      status: 'active',
    },
  ],

  '/api/v1/grants/dashboard': { totalGrants: 1, disbursedAmount: 25000000, pendingUCs: 0, totalGrantees: 1 },
  '/api/v1/grants/grants': [
    {
      id: 'grn-001',
      grantNo: 'GRANT-001',
      title: 'Rural Water Supply Scheme',
      granteeName: 'Rajasthan State Govt',
      totalAmount: 50000000,
      disbursedAmount: 25000000,
      pendingAmount: 25000000,
      sanctionDate: '2024-01-15',
      status: 'active',
    },
  ],
  '/api/v1/grants/grantees': [
    {
      id: 'gte-001',
      granteeCode: 'GTE-001',
      name: 'Rajasthan State Govt',
      type: 'government',
      activeGrants: 1,
      totalGrantsReceived: 50000000,
      ucCompliancePct: 100,
    },
  ],
  '/api/v1/grants/installments': [
    {
      id: 'inst-001',
      grantId: 'grn-001',
      grantNo: 'GRANT-001',
      granteeName: 'Rajasthan State Govt',
      installmentNo: 1,
      amount: 25000000,
      scheduledDate: '2024-01-20',
      releasedDate: '2024-01-20',
      status: 'released',
    },
  ],
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
      assetId: 'ast-001',
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
      minStockLevel: 50,
      unitCost: 15000,
      totalValue: 3000000,
      warehouseLocation: 'Main Store',
      isLowStock: false,
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
      status: 'pending',
    },
  ],
  '/api/v1/legal/hearings': [],
  '/api/v1/legal/court-orders': [],
  '/api/v1/legal/opinions': [],
  '/api/v1/legal/dashboard': { activeCases: 1, hearingsThisWeek: 0, ordersPending: 0, opinionsDue: 0 },

  '/api/v1/knowledge/documents': [
    {
      id: 'doc-001',
      title: 'Procurement Policy 2024',
      category: 'Policy',
      author: 'Admin',
      version: '1.0',
      createdAt: '2024-01-01T00:00:00Z',
      tags: ['procurement', 'policy'],
      accessLevel: 'public',
      status: 'approved',
    },
  ],
  '/api/v1/knowledge/records': [],

  '/api/v1/workflow/instances': [
    { id: 'wf-001', workflowName: 'Leave Approval', instanceNo: 'WF-001', status: 'running', startedAt: '2024-01-01T00:00:00Z' },
  ],
  '/api/v1/analytics/dashboards': [
    { id: 'ad-001', name: 'Finance KPI Dashboard', module: 'finance', status: 'active' },
  ],
  '/api/v1/inventory/items': [
    { id: 'inv-001', itemCode: 'INV-001', name: 'Office Chair', quantity: 10, status: 'active' },
  ],
  '/api/v1/telephony/calls': [
    { id: 'call-001', caller: '+91-9876543210', duration: 120, status: 'completed', startedAt: '2024-01-01T10:00:00Z' },
  ],
  '/api/v1/locations': [
    { id: 'loc-001', name: 'HQ Delhi', type: 'office', status: 'active' },
  ],
  '/api/notification/templates': [
    { id: 'tmpl-001', name: 'Bill Approved', channel: 'email', status: 'active' },
  ],
  '/api/notification/preferences': [
    { id: 'pref-001', eventType: 'bill.approved', module: 'finance', label: 'Bill Approved', emailEnabled: true, inAppEnabled: true },
  ],
  '/api/v1/install/stages': [
    { id: 'stage-001', stageNo: 1, title: 'Database Setup', status: 'completed' },
  ],
  '/api/v1/install/steps': [
    { id: 'step-001', stepNo: 1, title: 'Database Setup', description: 'Initialize PostgreSQL schema', isRequired: true, status: 'completed', completedAt: '2024-01-01T10:00:00Z' },
    { id: 'step-002', stepNo: 2, title: 'Seed Master Data', description: 'Load initial lookup tables', isRequired: true, status: 'completed', completedAt: '2024-01-01T10:05:00Z' },
    { id: 'step-003', stepNo: 3, title: 'Configure SMTP', description: 'Email delivery settings', isRequired: false, status: 'pending' },
  ],
  '/api/v1/plugins/items': [
    { name: 'PFMS Connector', status: 'enabled' },
    { name: 'Aadhaar eSign', status: 'disabled' },
  ],
  '/api/v1/themes/tokens': [
    { key: '--color-primary', value: '#0052cc' },
    { key: '--color-secondary', value: '#003087' },
    { key: '--font-family', value: 'Inter, sans-serif' },
  ],
  '/api/notification/notifications': [
    { id: 'notif-001', title: 'Bill Approved', message: 'Your bill PAY-001 has been approved.', module: 'finance', eventType: 'bill.approved', recipient: 'admin@example.com', channel: 'email', status: 'sent', createdAt: '2024-01-15T10:00:00Z' },
  ],
  '/api/v1/contract/contracts': [
    { id: 'con-001', contractNo: 'CON/2024/001', title: 'Annual AMC - IT Equipment', vendor: 'Tech Corp', startDate: '2024-01-01', endDate: '2024-12-31', value: 50000000, status: 'active' },
  ],
  '/api/v1/contract/rate-contracts': [
    { id: 'rc-001', contractNo: 'RC/2024/001', title: 'Stationery Rate Contract', vendor: 'Paper Mart', status: 'active' },
  ],
  '/api/v1/devices/register': { trustToken: 'test-trust-token' },

  '/api/v1/audit/observations': [
    {
      id: 'a0000000-0000-0000-0000-000000000001',
      observationNo: 'OBS-001',
      title: 'Weak access controls identified',
      type: 'internal',
      severity: 'major',
      raisedDate: '2024-01-15',
      dueDate: '2024-03-31',
      status: 'open',
    },
  ],

  '/api/v1/reports/dashboards': { kpis: [{ label: 'Reports Generated', value: '1', note: 'This month' }] },
  '/api/v1/reports/report-jobs': [
    {
      id: 'rpt-001',
      reportName: 'Monthly Finance Summary',
      module: 'finance',
      requestedBy: 'Admin User',
      requestedAt: '2024-01-31T10:00:00Z',
      completedAt: '2024-01-31T10:05:00Z',
      format: 'pdf',
      rowCount: 250,
      status: 'completed',
    },
  ],
  '/api/v1/reports/kpis': [
    {
      id: 'kpi-001',
      kpiName: 'Budget Utilization Rate',
      module: 'finance',
      targetValue: 80,
      currentValue: 75,
      unit: '%',
      achievementPct: 93.75,
      period: 'Q1 FY2024',
      trend: 'up',
      status: 'on_track',
    },
  ],
  '/api/v1/reports/mis': [
    { id: 'mis-001', module: 'finance', metric: 'Budget Utilization', value: 75, period: 'Q1 FY2024' },
  ],

  // ── Detail fixtures for [id] routes ──────────────────────────────────────
  '/api/v1/stock/items/sku-001': {
    id: 'sku-001',
    itemCode: 'SKU-001',
    name: 'A4 Paper Ream',
    category: 'Stationery',
    unit: 'Ream',
    currentStock: 200,
    minStockLevel: 50,
    maxStockLevel: 500,
    unitCost: 15000,
    totalValue: 3000000,
    warehouseLocation: 'Main Store',
    isLowStock: false,
    description: 'Standard A4 paper reams, 500 sheets per ream',
    hsnCode: '4802',
    gstRate: 12,
    stockLedger: [
      { id: 'led-001', date: '2024-01-10', type: 'receipt', quantity: 200, unitCost: 15000, totalValue: 3000000, referenceNo: 'GRN-001', party: 'Paper Mart India', balance: 200 },
    ],
  },

  '/api/v1/asset/assets/ast-001': {
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
    condition: 'good',
    description: 'High performance laptop for IT team',
    serialNo: 'SN-DELL-XPS15-001',
    warrantyExpiry: '2026-01-15',
    depreciationSchedule: [],
    maintenanceHistory: [],
  },

  '/api/v1/estab/files/fil-001': {
    id: 'fil-001',
    fileNo: 'FILE-001',
    subject: 'Annual Budget Proposal 2024',
    classification: 'confidential',
    department: 'Finance',
    createdBy: 'Admin User',
    createdDate: '2024-01-10',
    currentHolder: 'Director Finance',
    status: 'active',
    noteSheets: [],
    dispatchHistory: [],
    attachments: [],
  },

  '/api/v1/estab/meetings/mtg-001': {
    id: 'mtg-001',
    meetingNo: 'MTG-001',
    title: 'Quarterly Review Board Meeting',
    type: 'review',
    scheduledDate: '2024-02-15',
    scheduledTime: '10:00',
    venue: 'Conference Room A',
    chairperson: 'Secretary',
    attendeesCount: 12,
    agendaItemsCount: 3,
    status: 'scheduled',
  },

  '/api/v1/grants/grants/grn-001': {
    id: 'grn-001',
    grantNo: 'GRANT-001',
    title: 'Rural Water Supply Scheme',
    granteeName: 'Rajasthan State Govt',
    totalAmount: 50000000,
    disbursedAmount: 25000000,
    pendingAmount: 25000000,
    sanctionDate: '2024-01-15',
    status: 'active',
    conditions: 'Funds to be utilised within 2 FYs',
    installments: [
      { id: 'inst-1', installmentNo: 1, amount: 25000000, scheduledDate: '2024-01-20', releasedDate: '2024-01-20', status: 'released' },
    ],
    ucs: [],
  },

  '/api/v1/project/projects/prj-001': {
    id: 'prj-001',
    projectCode: 'PROJ-001',
    name: 'Highway Expansion Phase 1',
    scheme: 'PMGSY',
    department: 'Roads & Transport',
    startDate: '2024-01-01',
    totalBudget: 500000000,
    expenditure: 200000000,
    completionPct: 40,
    status: 'active',
    description: 'Phase 1 of National Highway expansion project',
    milestones: [
      { id: 'ms-1', title: 'Land Acquisition Complete', dueDate: '2024-03-31', completedDate: '2024-03-15', status: 'completed' },
    ],
    fundReleases: [],
  },

  '/api/v1/hrms/employees/EMP-001': {
    id: 'EMP-001',
    employeeId: 'EMP-001',
    name: 'Ravi Kumar',
    email: 'ravi.kumar@example.gov.in',
    phone: '+91-9876543210',
    department: 'IT',
    designation: 'Senior Engineer',
    grade: 'B',
    joiningDate: '2020-03-01',
    status: 'Active',
    reportingTo: 'Director IT',
    postingLocation: 'HQ Delhi',
  },

  '/api/v1/legal/cases/leg-001': {
    id: 'leg-001',
    caseNo: 'CASE-001',
    title: 'State v. ABC Construction Ltd',
    court: 'High Court Delhi',
    type: 'civil',
    filedDate: '2023-06-01',
    department: 'Works',
    petitioner: 'State of Delhi',
    respondent: 'ABC Construction Ltd',
    advocateName: 'Adv. Rajesh Kumar',
    nextHearingDate: '2024-03-15',
    status: 'active',
    hearings: [],
    orders: [],
  },

  '/api/v1/crm/contacts/c0000000-0000-0000-0000-000000000001/detail': {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Anita Desai',
    email: 'anita@example.com',
    phone: '+91-9876543210',
    organization: 'GoI Dept',
    designation: 'Director',
    tags: [],
    deals: [],
    activityTimeline: [],
  },
  '/api/v1/crm/contacts/c0000000-0000-0000-0000-000000000001': {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Anita Desai',
    email: 'anita@example.com',
    phone: '+91-9876543210',
    organization: 'GoI Dept',
    designation: 'Director',
    tags: [],
    deals: [],
    activityTimeline: [],
  },

  '/api/v1/citizen/tickets/t0000000-0000-0000-0000-000000000001': {
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

  '/api/v1/procurement/vendors/v0000000-0000-0000-0000-000000000001': {
    id: 'v0000000-0000-0000-0000-000000000001',
    vendorCode: 'VEN-001',
    name: 'Tech Supplies Ltd',
    gstin: '29ABCDE1234F1Z5',
    category: 'IT',
    empanelmentStatus: 'empanelled',
    rating: 4.5,
    contactPerson: 'Rahul Sharma',
    email: 'rahul@techsupplies.com',
    phone: '+91-9988776655',
  },
  '/api/v1/procurement/vendors/eeeeeeee-0001-0000-0000-000000000001': {
    id: 'eeeeeeee-0001-0000-0000-000000000001',
    vendorCode: 'VEN-BEL-001',
    name: 'Bharat Electronics',
    gstin: '27AABCB1234F1Z5',
    category: 'Electronics',
    empanelmentStatus: 'empanelled',
    rating: 4.8,
    contactPerson: 'Suresh Babu',
    email: 'suresh@bharatelectronics.gov.in',
    phone: '+91-11-23456789',
    address: 'New Delhi',
  },

  '/api/v1/procurement/grn/11111111-0002-0000-0000-000000000005': {
    id: '11111111-0002-0000-0000-000000000005',
    status: 'three-way-match-passed',
    poRef: 'PO-2024-001',
    invoiceRef: 'INV-2024-001',
    items: [],
    threeWayMatch: { status: 'passed', description: 'three-way match verified' },
  },


  '/api/identity/users/u0000000-0000-0000-0000-000000000001': {
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
    sessions: [],
  },

  '/api/policy/roles/r0000000-0000-0000-0000-000000000001': {
    id: 'r0000000-0000-0000-0000-000000000001',
    tenantId: 't0000000-0000-0000-0000-000000000001',
    name: 'admin',
    description: 'System administrator',
    status: 'active',
    version: 1,
    isSystemRole: true,
    userCount: 1,
    createdAt: '2024-01-01T00:00:00Z',
    permissions: [],
    users: [],
  },

  '/api/v1/audit/observations/a0000000-0000-0000-0000-000000000001': {
    id: 'a0000000-0000-0000-0000-000000000001',
    observationNo: 'OBS-001',
    title: 'Weak access controls identified',
    type: 'internal',
    severity: 'major',
    raisedDate: '2024-01-15',
    dueDate: '2024-03-31',
    status: 'open',
    description: 'Access controls need strengthening in finance module',
    recommendations: 'Implement role-based access controls',
    replies: [],
  },
};

function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = (req.url ?? '/').split('?')[0];

  // Enforce auth: all non-identity routes require a Bearer token.
  const isPublic = path.startsWith('/api/identity') || path.startsWith('/api/v1/install');
  if (!isPublic) {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      res.writeHead(401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Bearer token required' }));
      return;
    }
  }

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

  // Also serve on 8080 so Next.js SSR (CIVITASONE_API_BASE_URL=http://localhost:8080) gets fixture data
  const server8080 = http.createServer(handler);
  let port8080Started = false;
  await new Promise<void>((resolve, reject) => {
    server8080.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log('[e2e] port 8080 is already in use — SSR mock will NOT start');
        resolve();
      } else { reject(err); }
    });
    server8080.listen(8080, '127.0.0.1', () => {
      port8080Started = true;
      console.log('[e2e] SSR mock gateway listening on http://127.0.0.1:8080');
      resolve();
    });
  });
  if (port8080Started) {
    (global as Record<string, unknown>).__e2eMockServer8080 = server8080;
  }
}
