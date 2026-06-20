import type {
  AccountSummary,
  ApprovalSummary,
  AttendanceSummary,
  AuditRowSummary,
  EmployeeSummary,
  HelpdeskTicketSummary,
  InstallerStageSummary,
  LeaveRequestSummary,
  MetricCard,
  PaymentSummary,
  PayrollRunSummary,
  PluginSummary,
  PurchaseOrderSummary,
  RoleAssignmentSummary,
  SLAQueueSummary,
  TenantSettingSummary,
  TenantUserSummary,
  ThemeTokenSummary,
  VendorSummary,
} from "@civitasone/types";

export const auditItems: AuditRowSummary[] = [
  { actor: "alice.kumar@gov.in", action: "User login", resource: "auth-service", outcome: "success" },
  { actor: "bob.singh@gov.in", action: "Role updated", resource: "tenant-admin", outcome: "success" },
  { actor: "system", action: "Password policy changed", resource: "policy-service", outcome: "success" },
];

export const helpdeskMetrics: MetricCard[] = [
  { label: "Avg first response", value: "42 min" },
  { label: "Avg resolution", value: "9.1 h" },
  { label: "SLA breach risk", value: "6 tickets" },
  { label: "CSAT", value: "4.6 / 5" },
];

export const slaRules: SLAQueueSummary[] = [
  { queue: "Critical", targetDisplay: "2h", breachedCount: 1 },
  { queue: "High", targetDisplay: "8h", breachedCount: 2 },
  { queue: "Normal", targetDisplay: "24h", breachedCount: 3 },
];

export const helpdeskTickets: HelpdeskTicketSummary[] = [
  { id: "TCK-1021", subject: "Payroll export failing", priority: "High", status: "Open" },
  { id: "TCK-1022", subject: "Role mapping mismatch", priority: "Medium", status: "In Progress" },
  { id: "TCK-1023", subject: "Dashboard load delay", priority: "Low", status: "Open" },
];

export const installerStages: InstallerStageSummary[] = [
  { name: "Tenant profile" },
  { name: "Identity provider" },
  { name: "Database and queue" },
  { name: "Storage and backups" },
  { name: "Policy baseline" },
  { name: "Readiness score" },
];

export const plugins: PluginSummary[] = [
  { name: "PFMS Connector", status: "enabled" },
  { name: "GeM Procurement Bridge", status: "enabled" },
  { name: "Legacy SAP Sync", status: "disabled" },
];

export const themeTokens: ThemeTokenSummary[] = [
  { key: "brand.primary", value: "#1D4ED8" },
  { key: "brand.secondary", value: "#0F766E" },
  { key: "density.default", value: "comfortable" },
  { key: "surface.canvas", value: "#F8FAFC" },
];

export const payments: PaymentSummary[] = [
  { referenceId: "PAY-901", beneficiary: "State IT Board", amountDisplay: "Rs 24,00,000", status: "Queued" },
  { referenceId: "PAY-902", beneficiary: "City Infra Corp", amountDisplay: "Rs 11,50,000", status: "Released" },
  { referenceId: "PAY-903", beneficiary: "Utility Services Ltd", amountDisplay: "Rs 3,20,000", status: "Pending Approval" },
];

export const tenantUsers: TenantUserSummary[] = [
  { name: "Alice Kumar", role: "Tenant Admin", status: "Active" },
  { name: "Bob Singh", role: "Finance Manager", status: "Active" },
  { name: "Carla Iyer", role: "HR Officer", status: "Suspended" },
];

export const tenantRoles: RoleAssignmentSummary[] = [
  { key: "finance.manager", assignedUsers: 12 },
  { key: "hr.officer", assignedUsers: 18 },
  { key: "procurement.approver", assignedUsers: 9 },
];

export const tenantSettings: TenantSettingSummary[] = [
  { name: "Session timeout policy" },
  { name: "Password complexity baseline" },
  { name: "Data retention defaults" },
  { name: "Notification channels" },
];

export const employees: EmployeeSummary[] = [
  { id: "EMP-001", name: "Anjali Mehra", department: "Finance", status: "Active" },
  { id: "EMP-002", name: "Rohit Anand", department: "HR", status: "Active" },
  { id: "EMP-003", name: "Neha Iqbal", department: "Procurement", status: "On Leave" },
];

export const leaveRequests: LeaveRequestSummary[] = [
  { id: "LV-401", employee: "Anjali Mehra", leaveType: "Casual Leave", status: "Pending" },
  { id: "LV-402", employee: "Rohit Anand", leaveType: "Medical Leave", status: "Approved" },
  { id: "LV-403", employee: "Neha Iqbal", leaveType: "Earned Leave", status: "Pending" },
];

export const attendanceSummaries: AttendanceSummary[] = [
  { date: "2026-05-24", presentCount: 412, absentCount: 18, lateCount: 9 },
  { date: "2026-05-23", presentCount: 405, absentCount: 22, lateCount: 11 },
  { date: "2026-05-22", presentCount: 418, absentCount: 15, lateCount: 7 },
];

export const payrollRuns: PayrollRunSummary[] = [
  { month: "May 2026", grossDisplay: "Rs 3.2 Cr", status: "In Processing" },
  { month: "Apr 2026", grossDisplay: "Rs 3.1 Cr", status: "Completed" },
  { month: "Mar 2026", grossDisplay: "Rs 3.0 Cr", status: "Completed" },
];

export const vendors: VendorSummary[] = [
  { name: "National Office Supplies", category: "Stationery", ratingDisplay: "4.5" },
  { name: "InfraCompute Pvt Ltd", category: "Infrastructure", ratingDisplay: "4.8" },
  { name: "Civic Networks", category: "Networking", ratingDisplay: "4.2" },
];

export const purchaseOrders: PurchaseOrderSummary[] = [
  { id: "PO-2026-001", vendor: "National Office Supplies", amountDisplay: "Rs 12,40,000", status: "Pending" },
  { id: "PO-2026-002", vendor: "InfraCompute Pvt Ltd", amountDisplay: "Rs 68,00,000", status: "Approved" },
  { id: "PO-2026-003", vendor: "Civic Networks", amountDisplay: "Rs 7,20,000", status: "Review" },
];

export const procurementApprovals: ApprovalSummary[] = [
  { id: "APR-771", referenceId: "PO-2026-008", owner: "Finance Manager", dueDisplay: "Today" },
  { id: "APR-772", referenceId: "PO-2026-009", owner: "Admin Officer", dueDisplay: "Tomorrow" },
  { id: "APR-773", referenceId: "PO-2026-010", owner: "Department Head", dueDisplay: "2 days" },
];

export const chartOfAccounts: AccountSummary[] = [
  { code: "1000", name: "Assets", type: "asset", currency: "INR", balanceDisplay: "12,500,000", status: "active" },
  { code: "1100", name: "Current Assets", type: "asset", currency: "INR", balanceDisplay: "8,500,000", status: "active" },
  { code: "1110", name: "Cash and Bank", type: "asset", currency: "INR", balanceDisplay: "5,000,000", status: "active" },
  { code: "2000", name: "Liabilities", type: "liability", currency: "INR", balanceDisplay: "3,500,000", status: "active" },
  { code: "4000", name: "Income", type: "income", currency: "INR", balanceDisplay: "15,000,000", status: "active" },
  { code: "5000", name: "Expenses", type: "expense", currency: "INR", balanceDisplay: "6,000,000", status: "active" },
];
