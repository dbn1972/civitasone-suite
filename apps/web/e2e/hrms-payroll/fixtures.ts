/**
 * Shared fixture data for HRMS & Payroll E2E tests.
 * Shapes match the actual API response schemas from @civitasone/schemas/web.
 */

// ── Employees ────────────────────────────────────────────────────────────────

export const employees = {
  data: [
    { id: 'emp-001', name: 'Ravi Kumar', department: 'IT', designation: 'Senior Engineer', status: 'Active', dateOfJoining: '2020-03-01', employeeType: 'permanent' },
    { id: 'emp-002', name: 'Priya Singh', department: 'Finance', designation: 'Accounts Officer', status: 'Active', dateOfJoining: '2019-06-15', employeeType: 'permanent' },
    { id: 'emp-003', name: 'Ankit Verma', department: 'HR', designation: 'HR Executive', status: 'Probation', dateOfJoining: '2024-01-10', employeeType: 'temporary' },
    { id: 'emp-004', name: 'Meera Patel', department: 'Works', designation: 'Junior Engineer', status: 'Active', dateOfJoining: '2021-08-01', employeeType: 'contract' },
    { id: 'emp-005', name: 'Deepak Sharma', department: 'Legal', designation: 'Legal Advisor', status: 'Separated', dateOfJoining: '2015-04-01', employeeType: 'deputation' },
  ],
  pagination: { hasMore: false, pageSize: 50 },
};

export const employeeDetail = {
  id: 'emp-001',
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
  employeeType: 'permanent',
  dateOfBirth: '1990-05-15',
  gender: 'male',
  maritalStatus: 'married',
  panNo: '****encrypted****',
  qualification: 'B.Tech Computer Science',
};

// ── Leave ────────────────────────────────────────────────────────────────────

export const leaveRequests = {
  data: [
    { id: 'lr-001', employeeId: 'emp-001', employeeName: 'Ravi Kumar', leaveType: 'Casual Leave', fromDate: '2024-07-15', toDate: '2024-07-16', days: 2, status: 'approved', reason: 'Personal work' },
    { id: 'lr-002', employeeId: 'emp-002', employeeName: 'Priya Singh', leaveType: 'Earned Leave', fromDate: '2024-08-01', toDate: '2024-08-05', days: 5, status: 'pending', reason: 'Family vacation' },
    { id: 'lr-003', employeeId: 'emp-003', employeeName: 'Ankit Verma', leaveType: 'Half Pay Leave', fromDate: '2024-07-20', toDate: '2024-07-20', days: 1, status: 'rejected', reason: 'Medical appointment' },
    { id: 'lr-004', employeeId: 'emp-004', employeeName: 'Meera Patel', leaveType: 'Maternity Leave', fromDate: '2024-09-01', toDate: '2024-12-28', days: 180, status: 'approved', reason: 'Maternity' },
  ],
};

export const leaveAllocations = {
  data: [
    { id: 'la-001', employeeId: 'emp-001', leaveTypeId: 'lt-001', leaveTypeName: 'Casual Leave', totalDays: 8, usedDays: 3, balanceDays: 5, year: 2024 },
    { id: 'la-002', employeeId: 'emp-001', leaveTypeId: 'lt-002', leaveTypeName: 'Earned Leave', totalDays: 30, usedDays: 10, balanceDays: 20, year: 2024 },
    { id: 'la-003', employeeId: 'emp-002', leaveTypeId: 'lt-001', leaveTypeName: 'Casual Leave', totalDays: 8, usedDays: 0, balanceDays: 8, year: 2024 },
  ],
};

export const leaveTypes = [
  { id: 'lt-001', name: 'Casual Leave', code: 'CL', maxDays: 8, carryForward: false },
  { id: 'lt-002', name: 'Earned Leave', code: 'EL', maxDays: 30, carryForward: true },
  { id: 'lt-003', name: 'Half Pay Leave', code: 'HPL', maxDays: 20, carryForward: true },
  { id: 'lt-004', name: 'Maternity Leave', code: 'ML', maxDays: 180, carryForward: false },
  { id: 'lt-005', name: 'Paternity Leave', code: 'PL', maxDays: 15, carryForward: false },
  { id: 'lt-006', name: 'Child Care Leave', code: 'CCL', maxDays: 730, carryForward: false },
];

// ── Attendance ───────────────────────────────────────────────────────────────

export const attendanceRecords = {
  data: [
    { id: 'att-001', employeeId: 'emp-001', employeeName: 'Ravi Kumar', date: '2024-07-15', status: 'present', checkIn: '09:00', checkOut: '18:00', hoursWorked: 9 },
    { id: 'att-002', employeeId: 'emp-002', employeeName: 'Priya Singh', date: '2024-07-15', status: 'present', checkIn: '09:15', checkOut: '17:45', hoursWorked: 8.5 },
    { id: 'att-003', employeeId: 'emp-003', employeeName: 'Ankit Verma', date: '2024-07-15', status: 'absent', checkIn: null, checkOut: null, hoursWorked: 0 },
    { id: 'att-004', employeeId: 'emp-004', employeeName: 'Meera Patel', date: '2024-07-15', status: 'on_leave', checkIn: null, checkOut: null, hoursWorked: 0 },
  ],
};

export const attendanceSummary = {
  data: [
    { employeeId: 'emp-001', employeeName: 'Ravi Kumar', present: 22, absent: 0, onLeave: 2, wfh: 1, totalDays: 25 },
    { employeeId: 'emp-002', employeeName: 'Priya Singh', present: 20, absent: 1, onLeave: 3, wfh: 1, totalDays: 25 },
    { employeeId: 'emp-003', employeeName: 'Ankit Verma', present: 18, absent: 5, onLeave: 2, wfh: 0, totalDays: 25 },
  ],
};

export const attendanceLocks = {
  data: [
    { period: '2024-06', lockedAt: '2024-07-01T00:00:00Z', lockedBy: 'hr_admin' },
  ],
};

export const regularisations = {
  data: [
    { id: 'reg-001', employeeId: 'emp-003', employeeName: 'Ankit Verma', date: '2024-07-10', originalStatus: 'absent', requestedStatus: 'present', reason: 'Was on field duty', status: 'pending' },
  ],
};

// ── Payroll ──────────────────────────────────────────────────────────────────

export const payrollRuns = {
  data: [
    { id: 'run-001', payPeriod: '2024-07', runDate: '2024-07-28', status: 'paid', employeeCount: 150, grossAmount: 15000000, deductions: 3000000, netAmount: 12000000 },
    { id: 'run-002', payPeriod: '2024-06', runDate: '2024-06-28', status: 'paid', employeeCount: 148, grossAmount: 14800000, deductions: 2960000, netAmount: 11840000 },
    { id: 'run-003', payPeriod: '2024-08', runDate: '2024-08-01', status: 'draft', employeeCount: 152, grossAmount: 15200000, deductions: 3040000, netAmount: 12160000 },
  ],
};

export const payrollRunDetail = {
  id: 'run-001',
  payPeriod: '2024-07',
  runDate: '2024-07-28',
  status: 'paid',
  employeeCount: 150,
  grossAmount: 15000000,
  deductions: 3000000,
  netAmount: 12000000,
  salarySlips: [
    { id: 'slip-001', employeeId: 'emp-001', employeeName: 'Ravi Kumar', gross: 120000, deductions: 24000, net: 96000, status: 'paid' },
    { id: 'slip-002', employeeId: 'emp-002', employeeName: 'Priya Singh', gross: 95000, deductions: 19000, net: 76000, status: 'paid' },
    { id: 'slip-003', employeeId: 'emp-003', employeeName: 'Ankit Verma', gross: 55000, deductions: 11000, net: 44000, status: 'paid' },
  ],
};

export const payrollRunDraft = {
  id: 'run-003',
  payPeriod: '2024-08',
  runDate: '2024-08-01',
  status: 'draft',
  employeeCount: 152,
  grossAmount: 15200000,
  deductions: 3040000,
  netAmount: 12160000,
  salarySlips: [
    { id: 'slip-010', employeeId: 'emp-001', employeeName: 'Ravi Kumar', gross: 120000, deductions: 24000, net: 96000, status: 'draft' },
    { id: 'slip-011', employeeId: 'emp-002', employeeName: 'Priya Singh', gross: 95000, deductions: 19000, net: 76000, status: 'draft' },
  ],
};

export const payrollStructures = {
  data: [
    { id: 'str-001', name: 'Regular Pay Structure', isDefault: true, status: 'active' },
    { id: 'str-002', name: 'Contract Pay Structure', isDefault: false, status: 'active' },
    { id: 'str-003', name: 'Deputation Pay Structure', isDefault: false, status: 'inactive' },
  ],
};

export const payrollComponents = {
  data: [
    { id: 'comp-001', name: 'Basic Pay', type: 'earning', calculationType: 'fixed', isStatutory: true },
    { id: 'comp-002', name: 'DA', type: 'earning', calculationType: 'percentage', isStatutory: true },
    { id: 'comp-003', name: 'HRA', type: 'earning', calculationType: 'percentage', isStatutory: false },
    { id: 'comp-004', name: 'PF', type: 'deduction', calculationType: 'percentage', isStatutory: true },
    { id: 'comp-005', name: 'Professional Tax', type: 'deduction', calculationType: 'slab', isStatutory: true },
  ],
  meta: { page: 1, pageSize: 50, total: 5 },
};

export const salarySlips = {
  data: [
    { id: 'slip-001', employeeId: 'emp-001', employeeName: 'Ravi Kumar', month: '2024-07', grossAmount: 120000, netAmount: 96000, status: 'generated' },
    { id: 'slip-002', employeeId: 'emp-002', employeeName: 'Priya Singh', month: '2024-07', grossAmount: 95000, netAmount: 76000, status: 'generated' },
  ],
};

export const ddos = [
  { ddoCode: 'DDO-001', name: 'District Treasury Officer', departmentIds: ['dept-001', 'dept-002'] },
  { ddoCode: 'DDO-002', name: 'PAO Finance Ministry', departmentIds: ['dept-003'] },
];

export const pensioners = [
  { id: 'pen-001', ppoNo: 'PPO-2024-001', fullName: 'Ram Prasad Sharma', dateOfBirth: '1960-05-10', basicPensionMinor: 5000000, commutedPensionMinor: 1500000, commutationDate: '2020-04-01', medicalAllowanceMinor: 200000, ddoCode: 'DDO-001', taxRegime: 'old', status: 'active' },
  { id: 'pen-002', ppoNo: 'PPO-2024-002', fullName: 'Sita Devi', dateOfBirth: '1958-11-20', basicPensionMinor: 4000000, commutedPensionMinor: 1200000, commutationDate: '2018-12-31', medicalAllowanceMinor: 200000, ddoCode: 'DDO-001', taxRegime: 'old', status: 'active' },
];

// ── Recruitment ──────────────────────────────────────────────────────────────

export const recruitmentDashboard = {
  totalOpenings: 5,
  openVacancies: 3,
  publishedVacancies: 2,
  internshipsApprenticeships: 1,
  applicationsInternal: 12,
  applicationsPublic: 45,
};

export const jobOpenings = [
  { id: 'job-001', jobTitle: 'Senior Software Engineer', department: 'IT', vacancies: 3, status: 'published', applicationsReceived: 28, postedDate: '2024-07-01', applicationDeadline: '2024-08-31' },
  { id: 'job-002', jobTitle: 'Accounts Officer', department: 'Finance', vacancies: 1, status: 'open', applicationsReceived: 15, postedDate: '2024-07-10', applicationDeadline: '2024-08-15' },
  { id: 'job-003', jobTitle: 'Legal Associate', department: 'Legal', vacancies: 2, status: 'draft', applicationsReceived: 0, postedDate: '2024-07-20' },
];

// ── HR Sub-modules ───────────────────────────────────────────────────────────

export const transfers = {
  data: [
    { id: 'tr-001', employee: 'Ravi Kumar', fromOffice: 'HQ Delhi', toOffice: 'Branch Jaipur', transferDate: '2024-08-01', orderNo: 'TRF/2024/001', relievingDate: '2024-08-15', status: 'completed' },
    { id: 'tr-002', employee: 'Meera Patel', fromOffice: 'Branch Bhopal', toOffice: 'HQ Delhi', transferDate: '2024-09-01', orderNo: 'TRF/2024/002', relievingDate: '', status: 'pending' },
  ],
};

export const promotions = {
  data: [
    { id: 'promo-001', employee: 'Ravi Kumar', fromDesignation: 'Engineer', toDesignation: 'Senior Engineer', effectiveDate: '2024-04-01', orderNo: 'PROMO/2024/001', status: 'completed' },
    { id: 'promo-002', employee: 'Priya Singh', fromDesignation: 'Junior AO', toDesignation: 'Accounts Officer', effectiveDate: '2024-07-01', orderNo: 'PROMO/2024/002', status: 'pending' },
  ],
};

export const trainingPrograms = [
  { id: 'trn-001', title: 'Cybersecurity Awareness', type: 'mandatory', startDate: '2024-08-15', endDate: '2024-08-17', enrolled: 50, completed: 0, status: 'upcoming' },
  { id: 'trn-002', title: 'Leadership Development', type: 'elective', startDate: '2024-06-01', endDate: '2024-06-05', enrolled: 20, completed: 18, status: 'completed' },
];

export const appraisals = [
  { id: 'apr-001', employeeName: 'Ravi Kumar', cycle: 'FY 2023-24', rating: 4.2, status: 'completed', reviewer: 'Director IT' },
  { id: 'apr-002', employeeName: 'Priya Singh', cycle: 'FY 2023-24', rating: 3.8, status: 'completed', reviewer: 'CFO' },
  { id: 'apr-003', employeeName: 'Ankit Verma', cycle: 'FY 2023-24', rating: 0, status: 'pending', reviewer: 'HR Director' },
];

export const hrDashboard = {
  headcount: 152,
  attendanceTodayPct: 92,
  pendingLeaves: 3,
  payrollDue: 1,
};

// ── 202 Accepted (CQRS) ─────────────────────────────────────────────────────

export const acceptedResponse = {
  commandId: 'cmd-e2e-test-001',
  messageId: 'msg-e2e-test-001',
  accepted: true,
};

// ── Onboarding ───────────────────────────────────────────────────────────────

export const onboardingRows = [
  {
    id: 'ob-001',
    employee: 'Sunita Rao',
    department: 'Finance',
    joiningDate: '2026-08-11',
    reportingManager: 'CFO Mahesh Iyer',
    officeLocation: 'Block C, Udyog Bhavan, Minto Road, New Delhi — 110 001',
    stepsCompleted: 2,
    totalSteps: 5,
    overdue: 0,
    progress: '40',
    status: 'in_progress',
    checklist: [
      { id: 'docs', label: 'Documents Submitted', status: 'completed', dueDay: 1 },
      { id: 'id-card', label: 'ID Card Issued', status: 'completed', dueDay: 3 },
      { id: 'workstation', label: 'Workstation Assigned', status: 'in_progress', dueDay: 3 },
      { id: 'it-access', label: 'IT Access Created', status: 'pending', dueDay: 7 },
      { id: 'induction', label: 'Induction Completed', status: 'pending', dueDay: 7 },
    ],
    documents: [
      { id: 'doc-appt', name: 'Appointment Letter', required: true, status: 'verified', category: 'document' },
      { id: 'doc-id', name: 'Government ID Proof', required: true, status: 'uploaded', category: 'document' },
      { id: 'doc-address', name: 'Address Proof', required: true, status: 'pending', category: 'document' },
      { id: 'doc-education', name: 'Education Certificate', required: true, status: 'pending', category: 'document' },
      { id: 'doc-pan', name: 'PAN Card', required: true, status: 'uploaded', category: 'document' },
      { id: 'doc-bank', name: 'Bank Account Details', required: true, status: 'pending', category: 'document' },
    ],
    tasks: [
      { id: 't1', title: 'Complete document submission', milestoneDay: 1, status: 'completed' },
      { id: 't2', title: 'Collect ID card', milestoneDay: 3, status: 'completed' },
      { id: 't3', title: 'Workstation setup', milestoneDay: 3, status: 'in_progress' },
      { id: 't4', title: 'IT access & VPN setup', milestoneDay: 7, status: 'pending' },
      { id: 't5', title: 'HR induction session', milestoneDay: 7, status: 'pending' },
      { id: 't6', title: 'Probation review meeting', milestoneDay: 30, status: 'pending' },
    ],
  },
  {
    id: 'ob-002',
    employee: 'Rajesh Nambiar',
    department: 'IT',
    joiningDate: '2026-08-01',
    reportingManager: 'Director IT',
    officeLocation: 'Block A, Electronics Niketan, CGO Complex, New Delhi — 110 003',
    stepsCompleted: 1,
    totalSteps: 5,
    overdue: 2,
    progress: '20',
    status: 'overdue',
    checklist: [
      { id: 'docs', label: 'Documents Submitted', status: 'completed', dueDay: 1 },
      { id: 'id-card', label: 'ID Card Issued', status: 'overdue', dueDay: 3 },
      { id: 'workstation', label: 'Workstation Assigned', status: 'overdue', dueDay: 3 },
      { id: 'it-access', label: 'IT Access Created', status: 'pending', dueDay: 7 },
      { id: 'induction', label: 'Induction Completed', status: 'pending', dueDay: 7 },
    ],
    documents: [
      { id: 'doc-appt', name: 'Appointment Letter', required: true, status: 'verified', category: 'document' },
      { id: 'doc-id', name: 'Government ID Proof', required: true, status: 'pending', category: 'document' },
      { id: 'doc-address', name: 'Address Proof', required: true, status: 'pending', category: 'document' },
      { id: 'doc-education', name: 'Education Certificate', required: true, status: 'pending', category: 'document' },
      { id: 'doc-pan', name: 'PAN Card', required: true, status: 'pending', category: 'document' },
      { id: 'doc-bank', name: 'Bank Account Details', required: true, status: 'pending', category: 'document' },
    ],
    tasks: [
      { id: 't1', title: 'Complete document submission', milestoneDay: 1, status: 'completed' },
      { id: 't2', title: 'Collect ID card', milestoneDay: 3, status: 'overdue' },
      { id: 't3', title: 'Workstation setup', milestoneDay: 3, status: 'overdue' },
      { id: 't4', title: 'IT access & VPN setup', milestoneDay: 7, status: 'pending' },
      { id: 't5', title: 'HR induction session', milestoneDay: 7, status: 'pending' },
    ],
  },
];

export const onboardingEmpty: never[] = [];
