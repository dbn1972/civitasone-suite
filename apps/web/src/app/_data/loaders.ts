import type { z } from "zod";
import type {
  AccountSummary,
  AppraisalSummary,
  ApprovalSummary,
  AttendanceRegularisation,
  AttendanceSummary,
  AttendanceSummaryItem,
  AuditRowSummary,
  ActivitySummary,
  CRMAccountNode,
  CRMAccountSummary,
  CRMContactSummary,
  CRMDealSummary,
  CRMDashboard,
  CRMCampaignRoi,
  CRMCampaignRoiSummaryRow,
  CRMLeadCaptureForm,
  CRMControlTower,
  NotificationExperiment,
  CRMForecast,
  CRMVocSummary,
  AccountHealthEntry,
  AccountHealthBreakdown,
  CopilotTurn,
  ChatConversation,
  ChatMessage,
  DealSummary,
  ContactDetail,
  CRMActivityEntry,
  TicketDetail,
  TicketAnalytics,
  CitizenRequestSummary,
  RTISummary,
  EmployeeDetail,
  EmployeeSummary,
  HRDashboard,
  LeaveInboxItem,
  JobOpeningSummary,
  LeaveRequestDetail,
  ModuleRowSummary,
  HelpdeskTicketSummary,
  InternalHelpdeskTicketSummary,
  InstallerStageSummary,
  LeaveRequestSummary,
  MetricCard,
  OrgChartNode,
  PaymentSummary,
  PayrollRunDetail,
  PayrollRunFullDetail,
  PayrollRunSummary,
  PayrollStructure,
  PluginSummary,
  RoleAssignmentSummary,
  SalarySlipSummary,
  SLAQueueSummary,
  TaxDeclaration,
  TenantSettingSummary,
  TenantUserSummary,
  ThemeTokenSummary,
  TrainingProgramSummary,
  VendorSummary,
  PurchaseOrderSummary,
  FinanceDashboard,
  BudgetSummary,
  SanctionSummary,
  SanctionDetail,
  BillSummary,
  BillDetail,
  AdvanceSummary,
  UCSummary,
  GLEntrySummary,
  FinancialStatementSummary,
  FinancePaymentDetail,
  FinanceInstrumentSummary,
  BudgetOutcomeSummary,
  AllocationDistributionSummary,
  FinanceBudgetAllocationSummary,
  BudgetMonitoringSummary,
  BudgetMonitoringLine,
  BudgetMonitoringLinesResponse,
  VendorTdsEntry,
  PfmsBatchSummary,
  CashBookEntry,
  FinanceChallanSummary,
  FinanceDepositSummary,
  FinanceGuaranteeSummary,
  FinanceDebtSummary,
  FinanceSchemeSummary,
  FinanceDemandSummary,
  FinanceAuditParaSummary,
  DisciplinaryCaseDetail,
  FinanceVendorDetail,
  FinanceVendorSummary,
  ProcurementDashboard,
  IndentSummary,
  IndentDetail,
  VendorDetail,
  RFQSummary,
  RFQDetail,
  GRNSummary,
  GRNDetail,
  GoodsReturnDetail,
  SrnDetail,
  CycleCountDetail,
  TenderSummary,
  TenderDetail,
  PurchaseOrderListItem,
  PODetail,
  ProjectsDashboard,
  ProjectSummary,
  ProjectDetail,
  MilestoneSummary,
  FundReleaseSummary,
  SchemeSummary,
  GrantsDashboard,
  GrantSummary,
  GrantDetail,
  GranteeSummary,
  GrantInstallmentSummary,
  GrantRelease,
  GrantUtilization,
  EstabDashboard,
  EstabFileSummary,
  EstabFileDetail,
  MeetingSummary,
  MeetingDetail,
  VehicleSummary,
  GuesthouseBookingSummary,
  ComplianceSummary,
  LibraryBookSummary,
  LibraryIssueSummary,
  AssetDashboard,
  AssetSummary,
  AssetDetail,
  MaintenanceSummary,
  StockDashboard,
  StockItemSummary,
  StockItemDetail,
  StockLedgerEntry,
  AuditDashboard,
  AuditObservationSummary,
  AuditObservationDetail,
  RiskSummary,
  AuditPlanItem,
  AuditComplianceItem,
  AuditExportJob,
  CagParaSummary,
  VigilanceCaseSummary,
  InvestigationSummary,
  LegalDashboard,
  LegalCaseSummary,
  LegalCaseDetail,
  HearingSummary,
  CourtOrderSummary,
  LegalOpinionSummary,
  UserSummary,
  UserDetail,
  RoleDetail,
  SessionSummary,
  BreakglassSummary,
  APIKeySummary,
  InstallStepSummary,
  NotificationPrefSummary,
  SubscriptionSummary,
  TenantModule,
  TenantAuditEvent,
  ReportDashboard,
  ReportJobSummary,
  ReportJobDetail,
  KPISummary,
  MISSummary,
  KnowledgeDocSummary,
  KnowledgeRecord,
  NotificationItem,
  NotificationDelivery,
  PensionerSummary,
} from "@civitasone/types";
import {
  AppraisalSummaryListSchema,
  AttendanceRegularisationListSchema,
  AttendanceSummaryListSchema,
  auditEventsListSchema,
  EmployeeDetailSchema,
  HRDashboardSchema,
  JobOpeningSummaryListSchema,
  LeaveRequestDetailListSchema,
  OrgChartSchema,
  PayrollRunDetailListSchema,
  PayrollRunFullDetailSchema,
  paymentsListSchema,
  SalarySlipSummaryListSchema,
  PayrollStructureListSchema,
  ticketsListSchema,
  metricsListResponseSchema,
  slaListResponseSchema,
  employeesListSchema,
  leaveListResponseSchema,
  attendanceSummaryResponseSchema,
  payrollRunsResponseSchema,
  TrainingProgramSummaryListSchema,
  vendorListResponseSchema,
  posListResponseSchema,
  approvalsListResponseSchema,
  tenantModulesResponseSchema,
  userListResponseSchema,
  roleListResponseSchema,
  crmAccountHierarchyListSchema,
  crmAccountsListSchema,
  crmContactsListSchema,
  crmDealsListSchema,
  crmActivitiesListSchema,
  crmForecastSchema,
  crmVocSummarySchema,
  crmCampaignRoiSchema,
  crmCampaignRoiSummarySchema,
  crmLeadCaptureFormSchema,
  crmControlTowerSchema,
  notificationExperimentListSchema,
  accountHealthWatchlistSchema,
  accountHealthBreakdownSchema,
  copilotTurnsListSchema,
  copilotTurnDetailSchema,
  chatConversationsListSchema,
  chatTranscriptSchema,
  FinanceDashboardSchema,
  BudgetSummaryListSchema,
  SanctionSummaryListSchema,
  SanctionDetailSchema,
  BillSummaryListSchema,
  BillDetailSchema,
  AdvanceSummaryListSchema,
  UCSummaryListSchema,
  GLEntrySummaryListSchema,
  FinancialStatementSummaryListSchema,
  FinancePaymentDetailSchema,
  FinanceInstrumentSummarySchema,
  FinanceInstrumentSummaryListSchema,
  BudgetOutcomeSummaryListSchema,
  AllocationDistributionSummaryListSchema,
  FinanceBudgetAllocationSummaryListSchema,
  BudgetMonitoringSummarySchema,
  BudgetMonitoringLineListSchema,
  BudgetMonitoringLinesResponseSchema,
  VendorTdsEntryListSchema,
  PfmsBatchSummaryListSchema,
  CashBookEntryListSchema,
  FinanceChallanSummarySchema,
  FinanceChallanSummaryListSchema,
  FinanceDepositSummaryListSchema,
  FinanceGuaranteeSummaryListSchema,
  FinanceDebtSummaryListSchema,
  FinanceSchemeSummarySchema,
  FinanceSchemeSummaryListSchema,
  FinanceDemandSummaryListSchema,
  FinanceAuditParaSummarySchema,
  FinanceAuditParaSummaryListSchema,
  DisciplinaryCaseDetailSchema,
  FinanceVendorDetailSchema,
  FinanceVendorSummaryListSchema,
  ProcurementDashboardSchema,
  IndentSummaryListSchema,
  IndentDetailSchema,
  VendorDetailListSchema,
  VendorDetailSchema,
  RFQSummaryListSchema,
  RFQDetailSchema,
  GRNSummaryListSchema,
  TenderSummaryListSchema,
  TenderDetailSchema,
  PurchaseOrderListItemListSchema,
  PODetailSchema,
  CRMDashboardSchema,
  DealSummaryListSchema,
  ContactDetailSchema,
  CRMActivityEntryListSchema,
  TicketDetailListSchema,
  TicketDetailSchema,
  TicketAnalyticsSchema,
  CitizenRequestSummaryListSchema,
  RTISummaryListSchema,
  ProjectsDashboardSchema,
  ProjectSummaryListSchema,
  ProjectDetailSchema,
  MilestoneSummaryListSchema,
  FundReleaseSummaryListSchema,
  SchemeSummaryListSchema,
  GrantsDashboardSchema,
  GrantSummaryListSchema,
  GrantDetailSchema,
  GranteeSummaryListSchema,
  GrantInstallmentSummaryListSchema,
  GrantReleaseListSchema,
  GrantUtilizationListSchema,
  EstabDashboardSchema,
  EstabFileSummaryListSchema,
  EstabFileDetailSchema,
  MeetingSummaryListSchema,
  MeetingDetailSchema,
  VehicleSummaryListSchema,
  GuesthouseBookingSummaryListSchema,
  ComplianceSummaryListSchema,
  LibraryBookSummaryListSchema,
  LibraryBookSummarySchema,
  LibraryIssueSummaryListSchema,
  AssetDashboardSchema,
  AssetSummaryListSchema,
  AssetDetailSchema,
  MaintenanceSummaryListSchema,
  StockDashboardSchema,
  StockItemSummaryListSchema,
  StockItemDetailSchema,
  StockLedgerEntryListSchema,
  AuditDashboardSchema,
  AuditObservationSummaryListSchema,
  AuditObservationDetailSchema,
  RiskSummaryListSchema,
  AuditPlanListSchema,
  AuditComplianceListSchema,
  AuditExportJobListSchema,
  CagParaSummaryListSchema,
  VigilanceCaseSummaryListSchema,
  InvestigationSummaryListSchema,
  LegalDashboardSchema,
  LegalCaseSummaryListSchema,
  LegalCaseDetailSchema,
  HearingSummaryListSchema,
  CourtOrderSummaryListSchema,
  LegalOpinionSummaryListSchema,
  SessionSummaryListSchema,
  BreakglassSummaryListSchema,
  APIKeySummaryListSchema,
  InstallStepSummaryListSchema,
  NotificationPrefSummaryListSchema,
  UserDetailSchema,
  RoleDetailSchema,
  SubscriptionSummarySchema,
  TenantModuleListSchema,
  AdminUserSummaryListSchema,
  AdminRoleSummaryListSchema,
  TenantAuditEventListSchema,
  ReportDashboardSchema,
  ReportJobSummaryListSchema,
  ReportJobDetailSchema,
  KPISummaryListSchema,
  MISSummaryListSchema,
  KnowledgeDocSummaryListSchema,
  KnowledgeRecordListSchema,
  NotificationItemListSchema,
  NotificationDeliveryListSchema,
} from "@civitasone/schemas/web";
import { fetchJson, type LoaderResult } from "./apiClient";
import {
  mapAdminUserSummaries,
  mapAssetSummaries,
  mapAssetDetail,
  mapDepreciationEntries,
  mapAssetMaintenanceHistory,
  mapCrmAccountNodes,
  mapCrmAccounts,
  mapCrmDealSummaries,
  mapDealSummaries,
  mapEstabFileSummaries,
  mapEstabFileDetail,
  mapHelpdeskTicketList,
  mapHelpdeskTicketDetail,
  mapLegalCaseSummaries,
  mapMaintenanceSummaries,
  mapProcurementIndentSummaries,
  mapProcurementIndentDetail,
  mapProcurementPOListItems,
  mapProcurementPODetail,
  mapProcurementGRNSummaries,
  mapProcurementGRNDetail,
  mapSrnDetail,
  mapGoodsReturnDetail,
  mapCycleCountDetail,
  mapProcurementVendorDetails,
  mapProcurementVendorDetail,
  mapPurchaseOrderSummaries,
  mapStockItemSummaries,
  mapStockItemDetail,
  mapStockLedgerEntries,
  mapTenantUsers as mapTenantUsersFromApi,
  mapVendorSummaries,
} from "./apiMappers";

export type { LoaderResult, LoaderSource } from "./apiClient";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getArrayPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data;
  }
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return payload.items;
  }
  return null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapAuditRows(payload: unknown): AuditRowSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: AuditRowSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const actor = toText(row.actor) ?? (isRecord(row.actor) ? toText(row.actor.email) ?? toText(row.actor.name) : null);
    const action = toText(row.action) ?? toText(row.type);
    const resource = toText(row.resource) ?? toText(row.target) ?? "unknown";
    const outcome =
      row.outcome === "success" || row.outcome === "failure"
        ? row.outcome
        : row.severity === "error" || row.severity === "critical"
          ? "failure"
          : "success";
    if (!actor || !action || !resource) continue;
    mapped.push({ actor, action, resource, outcome });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapMetrics(payload: unknown): MetricCard[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: MetricCard[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const label = toText(row.label);
    const value = toText(row.value);
    const note = toText(row.note) ?? undefined;
    if (!label || !value) continue;
    mapped.push({ label, value, note });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapSlaRules(payload: unknown): SLAQueueSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: SLAQueueSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const queue = toText(row.queue);
    const targetDisplay = toText(row.targetDisplay) ?? toText(row.target);
    const breachedCount =
      typeof row.breachedCount === "number"
        ? row.breachedCount
        : typeof row.breached === "number"
          ? row.breached
          : null;
    if (!queue || !targetDisplay || breachedCount === null) continue;
    mapped.push({ queue, targetDisplay, breachedCount });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapTickets(payload: unknown): HelpdeskTicketSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: HelpdeskTicketSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.ticketNo);
    const subject = toText(row.subject) ?? toText(row.title);
    const priority = row.priority;
    const status = row.status;
    if (!id || !subject) continue;
    if (priority !== "Low" && priority !== "Medium" && priority !== "High" && priority !== "Critical") continue;
    if (status !== "Open" && status !== "In Progress" && status !== "Resolved" && status !== "Closed") continue;
    mapped.push({ id, subject, priority, status });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapPayments(payload: unknown): PaymentSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: PaymentSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const referenceId = toText(row.referenceId) ?? toText(row.ref) ?? toText(row.id);
    const beneficiary = toText(row.beneficiary) ?? toText(row.payee);
    const amountDisplay = toText(row.amountDisplay) ?? toText(row.amount);
    const status = row.status;
    if (!referenceId || !beneficiary || !amountDisplay) continue;
    if (status !== "Queued" && status !== "Released" && status !== "Pending Approval" && status !== "Failed") continue;
    mapped.push({ ...(id ? { id } : {}), referenceId, beneficiary, amountDisplay, status });
  }
  return mapped.length > 0 ? mapped : null;
}

const EMPLOYEE_STATUSES = ["probation", "confirmed", "on_leave", "suspended", "deputation", "retired", "separated", "terminated"] as const;
type EmployeeStatus = typeof EMPLOYEE_STATUSES[number];

function toEmployeeStatus(value: unknown): EmployeeStatus {
  const s = typeof value === "string" ? value.toLowerCase() : null;
  // Map legacy/display casing to canonical values
  if (s === "active") return "confirmed";
  if (s === "on leave" || s === "on_leave") return "on_leave";
  const found = EMPLOYEE_STATUSES.find((v) => v === s);
  return found ?? "probation";
}

function mapEmployees(payload: unknown): EmployeeSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: EmployeeSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.empCode);
    const empNo = toText(row.employeeNo) ?? toText(row.empCode);
    const name = toText(row.name);
    const department = toText(row.department) ?? toText(row.dept) ?? "—";
    const status = toEmployeeStatus(row.status);
    if (!id || !name) continue;
    mapped.push({ id, name, department, status, ...(empNo ? { employeeNo: empNo } : {}) });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapLeaveRequests(payload: unknown): LeaveRequestSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: LeaveRequestSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const employee = toText(row.employee) ?? toText(row.empName);
    const leaveType = toText(row.leaveType) ?? toText(row.type);
    const status = row.status;
    if (!id || !employee || !leaveType) continue;
    if (status !== "Pending" && status !== "Approved" && status !== "Rejected") continue;
    mapped.push({ id, employee, leaveType, status });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapAttendance(payload: unknown): AttendanceSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: AttendanceSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const date = toText(row.date);
    const presentCount = typeof row.presentCount === "number" ? row.presentCount : null;
    const absentCount = typeof row.absentCount === "number" ? row.absentCount : null;
    const lateCount = typeof row.lateCount === "number" ? row.lateCount : null;
    if (!date || presentCount === null || absentCount === null || lateCount === null) continue;
    mapped.push({ date, presentCount, absentCount, lateCount });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapPayrollRuns(payload: unknown): PayrollRunSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: PayrollRunSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const month = toText(row.month) ?? toText(row.period);
    const grossDisplay = toText(row.grossDisplay) ?? toText(row.gross);
    const status = row.status;
    if (!month || !grossDisplay) continue;
    if (status !== "In Processing" && status !== "Completed" && status !== "Failed") continue;
    mapped.push({ month, grossDisplay, status });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapApprovals(payload: unknown): ApprovalSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: ApprovalSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const referenceId = toText(row.referenceId) ?? toText(row.indentNo) ?? toText(row.ref);
    const owner = toText(row.owner) ?? toText(row.approver);
    const dueDisplay = toText(row.dueDisplay) ?? toText(row.due) ?? "—";
    if (!id || !referenceId || !owner) continue;
    mapped.push({ id, referenceId, owner, dueDisplay });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapAccounts(payload: unknown): AccountSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: AccountSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const code = toText(row.code) ?? toText(row.accountCode) ?? toText(row.headId);
    const name = toText(row.name) ?? toText(row.accountName);
    const type = row.type;
    const currency = toText(row.currency) ?? "INR";
    const balanceDisplay = toText(row.balanceDisplay) ?? toText(row.balance) ?? "0";
    const status = row.status;
    if (!code || !name) continue;
    if (type !== "asset" && type !== "liability" && type !== "equity" && type !== "income" && type !== "expense") continue;
    if (status !== "active" && status !== "inactive") continue;
    mapped.push({ code, name, type, currency, balanceDisplay, status });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapTenantRoles(payload: unknown): RoleAssignmentSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: RoleAssignmentSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const key = toText(row.key) ?? toText(row.name) ?? toText(row.id);
    const assignedUsers =
      typeof row.assignedUsers === "number"
        ? row.assignedUsers
        : typeof row.userCount === "number"
          ? row.userCount
          : 0;
    if (!key) continue;
    mapped.push({ key, assignedUsers });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapTenantSettings(payload: unknown): TenantSettingSummary[] | null {
  if (isRecord(payload) && Array.isArray(payload.items)) {
    return mapTenantSettings(payload.items);
  }
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: TenantSettingSummary[] = [];
  for (const row of rows) {
    if (typeof row === "string") {
      mapped.push({ name: row });
      continue;
    }
    if (!isRecord(row)) continue;
    const name = toText(row.name) ?? toText(row.key);
    if (!name) continue;
    mapped.push({ name });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getAuditItems(): Promise<LoaderResult<AuditRowSummary[]>> {
  return fetchJson("/api/audit/events", [] as AuditRowSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "audit.recent",
    responseSchema: auditEventsListSchema,
    mapResponse: mapAuditRows,
  });
}

/** HR-scoped audit log — filters to employee, leave, payroll resource types. */
export async function getHrAuditLog(limit = 50, offset = 0): Promise<LoaderResult<AuditRowSummary[]>> {
  return fetchJson(`/api/audit/events?resourceType=employee,leave_app,leave_type,leave_alloc,payroll_run,payroll_structure,salary_slip&limit=${limit}&offset=${offset}`, [] as AuditRowSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.audit-log",
    responseSchema: auditEventsListSchema,
    mapResponse: mapAuditRows,
  });
}

export async function getHelpdeskMetrics(): Promise<LoaderResult<MetricCard[]>> {
  return fetchJson("/api/v1/citizen/analytics/metrics", [] as MetricCard[], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.metrics",
    responseSchema: metricsListResponseSchema,
    mapResponse: mapMetrics,
  });
}

export async function getSlaRules(): Promise<LoaderResult<SLAQueueSummary[]>> {
  return fetchJson("/api/v1/citizen/analytics/sla-rules", [] as SLAQueueSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.sla_rules",
    responseSchema: slaListResponseSchema,
    mapResponse: mapSlaRules,
  });
}

/** Citizen-facing tickets (citizen-service). Powers /helpdesk/tickets. */
export async function getHelpdeskTickets(): Promise<LoaderResult<HelpdeskTicketSummary[]>> {
  return fetchJson("/api/v1/citizen/tickets", [] as HelpdeskTicketSummary[], {
    revalidateSeconds: 15,
    telemetryKey: "helpdesk.tickets",
    responseSchema: ticketsListSchema,
    mapResponse: mapTickets,
  });
}

/** Internal ops tickets (helpdesk-service). Powers /helpdesk/internal. */
export async function getInternalHelpdeskTickets(): Promise<LoaderResult<InternalHelpdeskTicketSummary[]>> {
  return fetchJson("/api/v1/helpdesk/tickets", [] as InternalHelpdeskTicketSummary[], {
    revalidateSeconds: 15,
    telemetryKey: "helpdesk.internal_tickets",
    responseSchema: ticketsListSchema,
    mapResponse: mapTickets,
  });
}

export async function getInstallerStages(): Promise<LoaderResult<InstallerStageSummary[]>> {
  return fetchJson("/api/v1/install/stages", [] as InstallerStageSummary[], {
    telemetryKey: "install.stages",
    mapResponse: (p) => getArrayPayload(p) as InstallerStageSummary[] | null,
  });
}

export async function getPlugins(): Promise<LoaderResult<PluginSummary[]>> {
  return fetchJson("/api/v1/plugins/items", [] as PluginSummary[], {
    telemetryKey: "plugins.items",
    mapResponse: (p) => getArrayPayload(p) as PluginSummary[] | null,
  });
}

export async function getThemeTokens(): Promise<LoaderResult<ThemeTokenSummary[]>> {
  return fetchJson("/api/v1/themes/tokens", [] as ThemeTokenSummary[], {
    telemetryKey: "themes.tokens",
    mapResponse: (p) => getArrayPayload(p) as ThemeTokenSummary[] | null,
  });
}

export async function getPayments(): Promise<LoaderResult<PaymentSummary[]>> {
  return fetchJson("/api/v1/finance/payments", [] as PaymentSummary[], {
    revalidateSeconds: 20,
    telemetryKey: "finance.payments",
    responseSchema: paymentsListSchema,
    mapResponse: mapPayments,
  });
}

export async function getFinancePaymentById(id: string): Promise<LoaderResult<FinancePaymentDetail | null>> {
  return fetchJson<unknown, FinancePaymentDetail | null>(`/api/v1/finance/payments/${id}`, null, {
    revalidateSeconds: 20,
    telemetryKey: "finance.payment.detail",
    responseSchema: FinancePaymentDetailSchema,
    mapResponse: (payload) => (isRecord(payload) ? (payload as FinancePaymentDetail) : null),
  });
}

export async function getTenantUsers(): Promise<LoaderResult<TenantUserSummary[]>> {
  return fetchJson("/api/identity/users", [] as TenantUserSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "tenant.users",
    mapResponse: mapTenantUsersFromApi,
  });
}

export async function getTenantRoles(): Promise<LoaderResult<RoleAssignmentSummary[]>> {
  return fetchJson("/api/policy/roles", [] as RoleAssignmentSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "tenant.roles",
    responseSchema: roleListResponseSchema,
    mapResponse: mapTenantRoles,
  });
}

export async function getTenantSettings(): Promise<LoaderResult<TenantSettingSummary[]>> {
  return fetchJson("/api/v1/admin/tenant/modules", [] as TenantSettingSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "tenant.settings",
    responseSchema: tenantModulesResponseSchema,
    mapResponse: mapTenantSettings,
  });
}

/**
 * The tenant's own enabled modules for NAV visibility, sourced from the module
 * composition engine (any authenticated user; RLS-scoped to their tenant).
 * Shape matches getTenantSettings so mapTenantSettings + the schema are reused;
 * an empty list (un-onboarded tenant) is treated by getEnabledModules as show-all.
 */
export async function getNavModules(): Promise<LoaderResult<TenantSettingSummary[]>> {
  return fetchJson("/api/v1/admin/composition/my-modules", [] as TenantSettingSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "tenant.nav_modules",
    responseSchema: tenantModulesResponseSchema,
    mapResponse: mapTenantSettings,
  });
}

export type ServiceHealthRow = { service: string; status: string };

export type TenantAdminReadiness = {
  overall: number;
  productionReady: boolean;
  allGreen: boolean;
};

export type TenantAdminDashboard = {
  kpis: MetricCard[];
  health: {
    status: "ok" | "degraded" | "down";
    services: ServiceHealthRow[];
  };
  readiness: TenantAdminReadiness | null;
  modules: TenantSettingSummary[];
};

function mapAggregateHealth(payload: unknown): TenantAdminDashboard["health"] | null {
  if (!isRecord(payload)) return null;
  const status = payload.status;
  if (status !== "ok" && status !== "degraded" && status !== "down") return null;
  const rawServices = payload.services;
  if (!Array.isArray(rawServices)) return null;
  const services: ServiceHealthRow[] = [];
  for (const row of rawServices) {
    if (!isRecord(row)) continue;
    const service = toText(row.service);
    const rowStatus = toText(row.status);
    if (!service || !rowStatus) continue;
    services.push({ service, status: rowStatus });
  }
  return { status, services };
}

function mapReadiness(payload: unknown): TenantAdminReadiness | null {
  if (!isRecord(payload)) return null;
  const overall = typeof payload.overall === "number" ? Math.round(payload.overall) : null;
  if (overall === null) return null;
  return {
    overall,
    productionReady: payload.productionReady === true,
    allGreen: payload.allGreen === true,
  };
}

function formatCount(value: number): string {
  return value.toLocaleString("en-IN");
}

function buildDashboardKpis(
  activeUsers: number,
  modules: TenantSettingSummary[],
  health: TenantAdminDashboard["health"],
  readiness: TenantAdminReadiness | null,
): MetricCard[] {
  const okServices = health.services.filter((s) => s.status === "ok").length;
  const totalServices = health.services.length;
  const kpis: MetricCard[] = [
    {
      label: "Active users",
      value: formatCount(activeUsers),
      note: "Tenant directory",
    },
    {
      label: "Enabled modules",
      value: formatCount(modules.length),
      note: modules.length === 1 ? "1 module" : "Configured",
    },
  ];
  if (totalServices > 0) {
    kpis.push({
      label: "Services healthy",
      value: `${okServices}/${totalServices}`,
      note: health.status,
    });
  }
  if (readiness) {
    kpis.push({
      label: "Readiness score",
      value: `${readiness.overall}/100`,
      note: readiness.productionReady ? "Production ready" : "Gates pending",
    });
  }
  return kpis;
}

export async function getTenantAdminDashboard(): Promise<LoaderResult<TenantAdminDashboard>> {
  const [usersResult, modulesResult, healthResult, readinessResult] = await Promise.all([
    getTenantUsers(),
    getTenantSettings(),
    fetchJson<unknown, TenantAdminDashboard["health"]>(
      "/api/v1/admin/health",
      { status: "down", services: [] },
      {
        revalidateSeconds: 30,
        telemetryKey: "tenant_admin.health",
        mapResponse: mapAggregateHealth,
      },
    ),
    fetchJson<unknown, TenantAdminReadiness | null>(
      "/api/v1/admin/health/readiness",
      null,
      {
        revalidateSeconds: 300,
        telemetryKey: "tenant_admin.readiness",
        mapResponse: mapReadiness,
      },
    ),
  ]);

  const activeUsers = usersResult.data.filter((u) => u.status === "Active").length;
  const health = healthResult.data;
  const readiness = readinessResult.data;
  const modules = modulesResult.data;

  const source =
    usersResult.source === "error" ||
    modulesResult.source === "error" ||
    healthResult.source === "error" ||
    readinessResult.source === "error"
      ? "error"
      : "api";

  return {
    source,
    data: {
      kpis: buildDashboardKpis(activeUsers, modules, health, readiness),
      health,
      readiness,
      modules,
    },
  };
}

export type AdminOperationProcess = {
  name: string;
  kind: "service" | "worker" | "infrastructure";
  status: string;
  restarts: number;
  cpuPct: number;
  memoryMb: number;
  uptimeSeconds: number | null;
};

export type AdminOperationScheduler = {
  name: string;
  ownerProcess: string;
  schedule: string;
  intervalMs?: number;
  status: "online" | "owner_down" | "unknown";
  lastObservedAt?: string;
};

export type AdminOperationsDashboard = {
  checkedAt: string;
  pm2Available: boolean;
  summary: {
    totalProcesses: number;
    onlineProcesses: number;
    workersOnline: number;
    workersTotal: number;
    failedJobs: number;
    outboxPending: number;
    queueHealthy: boolean;
  };
  processes: AdminOperationProcess[];
  queue: { healthy: boolean; detail: string };
  schedulers: AdminOperationScheduler[];
  outbox: { pending: number };
  recentErrors: Array<{ source: string; line: string }>;
  externalMonitorRecommendation: Array<{ tool: string; purpose: string }>;
};

const emptyOperationsDashboard: AdminOperationsDashboard = {
  checkedAt: "",
  pm2Available: false,
  summary: {
    totalProcesses: 0,
    onlineProcesses: 0,
    workersOnline: 0,
    workersTotal: 0,
    failedJobs: 0,
    outboxPending: 0,
    queueHealthy: false,
  },
  processes: [],
  queue: { healthy: false, detail: "operations API unavailable" },
  schedulers: [],
  outbox: { pending: 0 },
  recentErrors: [],
  externalMonitorRecommendation: [],
};

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapOperationsDashboard(payload: unknown): AdminOperationsDashboard | null {
  if (!isRecord(payload) || !isRecord(payload.summary) || !isRecord(payload.queue) || !isRecord(payload.outbox)) return null;
  const processes = Array.isArray(payload.processes)
    ? payload.processes.flatMap((row): AdminOperationProcess[] => {
        if (!isRecord(row)) return [];
        const name = toText(row.name);
        const kind = row.kind === "service" || row.kind === "worker" || row.kind === "infrastructure" ? row.kind : null;
        const status = toText(row.status);
        if (!name || !kind || !status) return [];
        return [{
          name,
          kind,
          status,
          restarts: toNumber(row.restarts),
          cpuPct: toNumber(row.cpuPct),
          memoryMb: toNumber(row.memoryMb),
          uptimeSeconds: toNullableNumber(row.uptimeSeconds),
        }];
      })
    : [];
  const schedulers = Array.isArray(payload.schedulers)
    ? payload.schedulers.flatMap((row): AdminOperationScheduler[] => {
        if (!isRecord(row)) return [];
        const name = toText(row.name);
        const ownerProcess = toText(row.ownerProcess);
        const schedule = toText(row.schedule);
        const status = row.status === "online" || row.status === "owner_down" || row.status === "unknown" ? row.status : null;
        if (!name || !ownerProcess || !schedule || !status) return [];
        return [{
          name,
          ownerProcess,
          schedule,
          status,
          intervalMs: toNullableNumber(row.intervalMs) ?? undefined,
          lastObservedAt: toText(row.lastObservedAt) ?? undefined,
        }];
      })
    : [];
  const recentErrors = Array.isArray(payload.recentErrors)
    ? payload.recentErrors.flatMap((row): Array<{ source: string; line: string }> => {
        if (!isRecord(row)) return [];
        const source = toText(row.source);
        const line = toText(row.line);
        return source && line ? [{ source, line }] : [];
      })
    : [];
  const externalMonitorRecommendation = Array.isArray(payload.externalMonitorRecommendation)
    ? payload.externalMonitorRecommendation.flatMap((row): Array<{ tool: string; purpose: string }> => {
        if (!isRecord(row)) return [];
        const tool = toText(row.tool);
        const purpose = toText(row.purpose);
        return tool && purpose ? [{ tool, purpose }] : [];
      })
    : [];

  return {
    checkedAt: toText(payload.checkedAt) ?? "",
    pm2Available: payload.pm2Available === true,
    summary: {
      totalProcesses: toNumber(payload.summary.totalProcesses),
      onlineProcesses: toNumber(payload.summary.onlineProcesses),
      workersOnline: toNumber(payload.summary.workersOnline),
      workersTotal: toNumber(payload.summary.workersTotal),
      failedJobs: toNumber(payload.summary.failedJobs),
      outboxPending: toNumber(payload.summary.outboxPending),
      queueHealthy: payload.summary.queueHealthy === true,
    },
    processes,
    queue: {
      healthy: payload.queue.healthy === true,
      detail: toText(payload.queue.detail) ?? "",
    },
    schedulers,
    outbox: {
      pending: toNumber(payload.outbox.pending),
    },
    recentErrors,
    externalMonitorRecommendation,
  };
}

export async function getAdminOperationsDashboard(): Promise<LoaderResult<AdminOperationsDashboard>> {
  return fetchJson<unknown, AdminOperationsDashboard>(
    "/api/v1/admin/operations",
    emptyOperationsDashboard,
    {
      revalidateSeconds: 15,
      telemetryKey: "tenant_admin.operations",
      mapResponse: mapOperationsDashboard,
    },
  );
}

export async function getEmployees(limit = 50, offset = 0): Promise<LoaderResult<EmployeeSummary[]>> {
  return fetchJson(`/api/v1/hrms/employees?limit=${limit}&offset=${offset}`, [] as EmployeeSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.employees",
    responseSchema: employeesListSchema,
    mapResponse: mapEmployees,
  });
}

/** Self-service profile for the logged-in employee (no admin role needed). */
export async function getMyProfile(): Promise<LoaderResult<{ id: string; name: string; department: string; employeeNo: string; status: string; designation: string } | null>> {
  return fetchJson<Record<string, unknown>, { id: string; name: string; department: string; employeeNo: string; status: string; designation: string } | null>(
    "/api/v1/hrms/me/profile",
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "hr.me.profile",
      mapResponse: (raw) => {
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        return {
          id: String(r.id ?? ""),
          name: String(r.fullName ?? r.name ?? ""),
          department: String(r.departmentId ?? ""),
          employeeNo: String(r.employeeNo ?? ""),
          status: String(r.status ?? "active"),
          designation: String(r.designationId ?? ""),
        };
      },
    },
  );
}

export async function getLeaveRequests(limit = 50, offset = 0): Promise<LoaderResult<LeaveRequestSummary[]>> {
  return fetchJson(`/api/v1/hrms/leave-applications?limit=${limit}&offset=${offset}`, [] as LeaveRequestSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.leave",
    responseSchema: leaveListResponseSchema,
    mapResponse: mapLeaveRequests,
  });
}

export async function getAttendanceSummaries(): Promise<LoaderResult<AttendanceSummary[]>> {
  return fetchJson("/api/v1/hrms/attendance/summary", [] as AttendanceSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.attendance",
    responseSchema: attendanceSummaryResponseSchema,
    mapResponse: mapAttendance,
  });
}

export async function getPayrollRuns(): Promise<LoaderResult<PayrollRunSummary[]>> {
  return fetchJson("/api/v1/payroll/runs", [] as PayrollRunSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.payroll",
    responseSchema: payrollRunsResponseSchema,
    mapResponse: mapPayrollRuns,
  });
}

export async function getVendors(): Promise<LoaderResult<VendorSummary[]>> {
  return fetchJson("/api/v1/procurement/vendors", [] as VendorSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "procurement.vendors",
    mapResponse: mapVendorSummaries,
  });
}

export async function getPurchaseOrders(): Promise<LoaderResult<PurchaseOrderSummary[]>> {
  return fetchJson("/api/v1/procurement/pos", [] as PurchaseOrderSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "procurement.orders",
    mapResponse: mapPurchaseOrderSummaries,
  });
}

export async function getProcurementApprovals(): Promise<LoaderResult<ApprovalSummary[]>> {
  return fetchJson<unknown, ApprovalSummary[]>(
    "/api/v1/procurement/approvals",
    [] as ApprovalSummary[],
    {
      revalidateSeconds: 30,
      telemetryKey: "procurement.approvals",
      responseSchema: approvalsListResponseSchema,
      mapResponse: mapApprovals,
    },
  );
}

export async function getChartOfAccounts(): Promise<LoaderResult<AccountSummary[]>> {
  return fetchJson<unknown, AccountSummary[]>(
    "/api/v1/finance/accounts",
    [] as AccountSummary[],
    {
      revalidateSeconds: 30,
      telemetryKey: "finance.chart_of_accounts",
      mapResponse: mapAccounts,
    },
  );
}

function mapCrmContacts(payload: unknown): CRMContactSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: CRMContactSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const name = toText(row.name);
    const id = toText(row.id) ?? undefined;
    const email = toText(row.email) ?? "";
    const phone = toText(row.phone) ?? "";
    const account = toText(row.company) ?? toText(row.account) ?? "—";
    const leadStatus = toText(row.leadStatus) ?? undefined;
    const lastActivity = toText(row.lastActivityAt)?.slice(0, 10) ?? undefined;
    const tags = Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [];
    if (!name) continue;
    const temperature = toText(row.temperature) ?? undefined;
    const priority = toText(row.priority) ?? undefined;
    const segment = toText(row.segment) ?? undefined;
    const product = toText(row.product) ?? undefined;
    const region = toText(row.region) ?? undefined;
    const expectedValueDisplay = toText(row.expectedValueDisplay) ?? undefined;
    mapped.push({ id, name, account, email, phone, leadStatus, tags, lastActivity, temperature, priority, segment, product, region, expectedValueDisplay });
  }
  return mapped.length > 0 ? mapped : null;
}

function mapCrmDeals(payload: unknown): CRMDealSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: CRMDealSummary[] = [];
  const stages = new Set(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const stage = toText(row.stage);
    const valueDisplay = toText(row.valueDisplay) ?? "—";
    if (!id || !name || !stage || !stages.has(stage)) continue;
    mapped.push({ id, name, stage: stage as CRMDealSummary["stage"], valueDisplay });
  }
  return mapped.length > 0 ? mapped : null;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function mapCrmActivities(payload: unknown): ActivitySummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: ActivitySummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const actor = toText(row.actorName) ?? toText(row.actor);
    const text = toText(row.text);
    const createdAt = toText(row.createdAt);
    if (!id || !actor || !text) continue;
    mapped.push({ id, actor, text, timeAgo: createdAt ? formatTimeAgo(createdAt) : "—" });
  }
  return mapped.length > 0 ? mapped : null;
}

export interface CrmContactsQuery {
  search?: string;
  /** Toolbar view-mode (mine/recent). Distinct from the classification segment. */
  segment?: string;
  /** LQ-003 classification segment filter (sent as `segmentName`). */
  segmentName?: string;
  temperature?: string;
  priority?: string;
  product?: string;
  region?: string;
  status?: string;
  source?: string;
}

export async function getCrmContacts(opts?: CrmContactsQuery): Promise<LoaderResult<CRMContactSummary[]>> {
  const qs = new URLSearchParams();
  if (opts?.search) qs.set("search", opts.search);
  if (opts?.segment && opts.segment !== "all") qs.set("segment", opts.segment);
  // LQ-003 classification / segmentation filters, forwarded to the list API.
  // The classification segment goes as `segmentName` (the backend reads that key;
  // `segment` above is the separate view-mode param).
  if (opts?.segmentName) qs.set("segmentName", opts.segmentName);
  if (opts?.temperature) qs.set("temperature", opts.temperature);
  if (opts?.priority) qs.set("priority", opts.priority);
  if (opts?.product) qs.set("product", opts.product);
  if (opts?.region) qs.set("region", opts.region);
  if (opts?.status) qs.set("status", opts.status);
  if (opts?.source) qs.set("source", opts.source);
  const path = qs.toString() ? `/api/v1/crm/contacts?${qs}` : "/api/v1/crm/contacts";
  return fetchJson(path, [] as CRMContactSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.contacts",
    responseSchema: crmContactsListSchema,
    mapResponse: mapCrmContacts,
  });
}

export async function getCrmAccounts(): Promise<LoaderResult<CRMAccountSummary[]>> {
  return fetchJson("/api/v1/crm/accounts", [] as CRMAccountSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.accounts",
    responseSchema: crmAccountsListSchema,
    mapResponse: mapCrmAccounts,
  });
}

/** Parent chain for an account, ordered nearest parent → root. */
export async function getCrmAccountAncestors(id: string): Promise<LoaderResult<CRMAccountNode[]>> {
  return fetchJson(`/api/v1/crm/accounts/${id}/ancestors`, [] as CRMAccountNode[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.account_ancestors",
    responseSchema: crmAccountHierarchyListSchema,
    mapResponse: mapCrmAccountNodes,
  });
}

/** Immediate child accounts of an account. */
export async function getCrmAccountChildren(id: string): Promise<LoaderResult<CRMAccountNode[]>> {
  return fetchJson(`/api/v1/crm/accounts/${id}/children`, [] as CRMAccountNode[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.account_children",
    responseSchema: crmAccountHierarchyListSchema,
    mapResponse: mapCrmAccountNodes,
  });
}

export async function getCrmDeals(): Promise<LoaderResult<CRMDealSummary[]>> {
  return fetchJson("/api/v1/crm/deals", [] as CRMDealSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.deals",
    mapResponse: mapCrmDealSummaries,
  });
}

export async function getCrmActivities(): Promise<LoaderResult<ActivitySummary[]>> {
  return fetchJson("/api/v1/crm/activities", [] as ActivitySummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.activities",
    responseSchema: crmActivitiesListSchema,
    mapResponse: mapCrmActivities,
  });
}

/**
 * Citizen Relationship Management — grievances + service requests.
 *
 * These deliberately do NOT use `moduleLoader`. The generic loader flattens
 * every row to `{ id, label, sublabel, status, meta }`, which discarded the
 * domain fields these registers are built on (citizenName vs subject, category,
 * priority, createdAt) and forced the pages to render the same value in two
 * columns. Both endpoints already return a `{ data, meta: { total } }` envelope,
 * so the real total is carried through as well — stat cards computed from the
 * current page alone were under-reporting once a tenant had more than one page.
 */
export type CrmGrievanceRow = {
  id: string;
  referenceNo: string | null;
  citizenName: string | null;
  category: string | null;
  subject: string | null;
  priority: string;
  status: string;
  assignedTo: string | null;
  dueAt: string | null;
  createdAt: string | null;
};

export type CrmServiceRequestRow = {
  id: string;
  referenceNo: string | null;
  citizenName: string | null;
  serviceType: string | null;
  subject: string | null;
  priority: string;
  status: string;
  assignedTo: string | null;
  dueAt: string | null;
  createdAt: string | null;
};

/** `{ data, meta: { total } }` → `{ rows, total }`, tolerating a bare array. */
function mapEnvelopeWithTotal<T>(payload: unknown, pick: (r: Record<string, unknown>) => T): { rows: T[]; total: number } | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped = rows.filter(isRecord).map(pick);
  const meta = isRecord(payload) && isRecord(payload.meta) ? payload.meta : undefined;
  const total = typeof meta?.total === "number" ? meta.total : mapped.length;
  return { rows: mapped, total };
}

export async function getCrmGrievances(
  params: { status?: string; priority?: string; search?: string; limit?: number; page?: number } = {},
): Promise<LoaderResult<{ rows: CrmGrievanceRow[]; total: number }>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.priority) qs.set("priority", params.priority);
  if (params.search) qs.set("search", params.search);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("page", String(params.page ?? 1));
  return fetchJson<unknown, { rows: CrmGrievanceRow[]; total: number }>(
    `/api/v1/crm/grievances?${qs.toString()}`,
    { rows: [], total: 0 },
    {
      revalidateSeconds: 30,
      telemetryKey: "crm.grievances",
      mapResponse: (p) =>
        mapEnvelopeWithTotal<CrmGrievanceRow>(p, (r) => ({
          id: toText(r.id) ?? "",
          referenceNo: toText(r.referenceNo),
          citizenName: toText(r.citizenName),
          category: toText(r.category),
          subject: toText(r.subject),
          priority: toText(r.priority) ?? "normal",
          status: toText(r.status) ?? "open",
          assignedTo: toText(r.assignedTo),
          dueAt: toText(r.dueAt),
          createdAt: toText(r.createdAt),
        })),
    },
  );
}

export async function getCrmServiceRequests(
  params: { status?: string; priority?: string; serviceType?: string; search?: string; limit?: number; page?: number } = {},
): Promise<LoaderResult<{ rows: CrmServiceRequestRow[]; total: number }>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.priority) qs.set("priority", params.priority);
  if (params.serviceType) qs.set("serviceType", params.serviceType);
  if (params.search) qs.set("search", params.search);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("page", String(params.page ?? 1));
  return fetchJson<unknown, { rows: CrmServiceRequestRow[]; total: number }>(
    `/api/v1/crm/service-requests?${qs.toString()}`,
    { rows: [], total: 0 },
    {
      revalidateSeconds: 30,
      telemetryKey: "crm.service-requests",
      mapResponse: (p) =>
        mapEnvelopeWithTotal<CrmServiceRequestRow>(p, (r) => ({
          id: toText(r.id) ?? "",
          referenceNo: toText(r.referenceNo),
          citizenName: toText(r.citizenName),
          serviceType: toText(r.serviceType),
          subject: toText(r.subject),
          priority: toText(r.priority) ?? "normal",
          status: toText(r.status) ?? "open",
          assignedTo: toText(r.assignedTo),
          dueAt: toText(r.dueAt),
          createdAt: toText(r.createdAt),
        })),
    },
  );
}

export type CrmRtiRow = {
  id: string;
  referenceNo: string | null;
  section: string;
  departmentRef: string;
  applicantName: string;
  applicantContact: string | null;
  subject: string;
  status: string;
  feePaid: boolean;
  feeAmount: number | null;
  receivedAt: string | null;
  dueAt: string | null;
  firstAppealDueAt: string | null;
  respondedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export async function getCrmRti(
  params: { status?: string; section?: string; departmentRef?: string; search?: string; limit?: number; page?: number } = {},
): Promise<LoaderResult<{ rows: CrmRtiRow[]; total: number }>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.section) qs.set("section", params.section);
  if (params.departmentRef) qs.set("departmentRef", params.departmentRef);
  if (params.search) qs.set("search", params.search);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("page", String(params.page ?? 1));
  return fetchJson<unknown, { rows: CrmRtiRow[]; total: number }>(
    `/api/v1/crm/rti?${qs.toString()}`,
    { rows: [], total: 0 },
    {
      revalidateSeconds: 30,
      telemetryKey: "crm.rti",
      mapResponse: (p) =>
        mapEnvelopeWithTotal<CrmRtiRow>(p, (r) => ({
          id: toText(r.id) ?? "",
          referenceNo: toText(r.referenceNo),
          section: toText(r.section) ?? "",
          departmentRef: toText(r.departmentRef) ?? "",
          applicantName: toText(r.applicantName) ?? "",
          applicantContact: toText(r.applicantContact),
          subject: toText(r.subject) ?? "",
          status: toText(r.status) ?? "RECEIVED",
          feePaid: r.feePaid === true,
          feeAmount: typeof r.feeAmount === "number" ? r.feeAmount : null,
          receivedAt: toText(r.receivedAt),
          dueAt: toText(r.dueAt),
          firstAppealDueAt: toText(r.firstAppealDueAt),
          respondedAt: toText(r.respondedAt),
          createdAt: toText(r.createdAt),
          updatedAt: toText(r.updatedAt),
        })),
    },
  );
}
function mapModuleRows(payload: unknown): ModuleRowSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: ModuleRowSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.referenceId);
    const label =
      toText(row.name) ??
      toText(row.title) ??
      toText(row.subject) ??
      toText(row.label) ??
      toText(row.code) ??
      toText(row.contractNo) ??
      toText(row.fileNo);
    if (!id || !label) continue;
    const sublabel =
      toText(row.dept) ??
      toText(row.category) ??
      toText(row.type) ??
      toText(row.vendor) ??
      toText(row.description);
    const status = toText(row.status);
    const meta =
      toText(row.code) ??
      toText(row.fileNo) ??
      toText(row.contractNo) ??
      toText(row.channel) ??
      toText(row.month);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
    });
  }
  return mapped.length > 0 ? mapped : null;
}

function moduleLoader(path: string, key: string) {
  return (): Promise<LoaderResult<ModuleRowSummary[]>> =>
    fetchJson<unknown, ModuleRowSummary[]>(path, [] as ModuleRowSummary[], {
      revalidateSeconds: 30,
      telemetryKey: key,
      mapResponse: mapModuleRows,
    });
}

export const getLegalCasesLegacy = moduleLoader("/api/v1/legal/cases", "legal.cases");
export const getProjectsLegacy = moduleLoader("/api/v1/project/projects", "projects.list");
export const getBillingPlans = moduleLoader("/api/v1/billing/plans", "billing.plans");
export const getBillingSubscriptions = moduleLoader("/api/v1/billing/subscriptions", "billing.subscriptions");
export const getBillingInvoices = moduleLoader("/api/v1/billing/invoices", "billing.invoices");
export const getBillingPayments = moduleLoader("/api/v1/billing/payments", "billing.payments");

export async function getBillingPlanById(id: string): Promise<LoaderResult<Record<string, unknown> | null>> {
  return fetchJson<unknown, Record<string, unknown> | null>(`/api/v1/billing/plans/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "billing.plan_detail",
    mapResponse: (payload) => (isRecord(payload) ? payload as Record<string, unknown> : null),
  });
}

export const getContracts = moduleLoader("/api/v1/contract/contracts", "contract.list");
export const getRateContracts = moduleLoader("/api/v1/contract/rate-contracts", "contract.rate");

export async function getContractById(id: string): Promise<LoaderResult<Record<string, unknown> | null>> {
  return fetchJson<unknown, Record<string, unknown> | null>(`/api/v1/contract/contracts/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "contract.detail",
    mapResponse: (payload) => (isRecord(payload) ? payload as Record<string, unknown> : null),
  });
}

export async function getContractMilestones(id: string): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>(`/api/v1/contract/contracts/${id}/milestones`, [], {
    revalidateSeconds: 15,
    telemetryKey: "contract.milestones",
    mapResponse: (payload) => {
      if (Array.isArray(payload)) return payload as Record<string, unknown>[];
      if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as Record<string, unknown>[];
      return [];
    },
  });
}

export async function getContractBonds(id: string): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>(`/api/v1/contract/contracts/${id}/bonds`, [], {
    revalidateSeconds: 15,
    telemetryKey: "contract.bonds",
    mapResponse: (payload) => {
      if (Array.isArray(payload)) return payload as Record<string, unknown>[];
      if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as Record<string, unknown>[];
      return [];
    },
  });
}

export async function getContractObligations(id: string): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>(`/api/v1/contract/obligations?contractId=${id}`, [], {
    revalidateSeconds: 15,
    telemetryKey: "contract.obligations",
    mapResponse: (payload) => {
      if (Array.isArray(payload)) return payload as Record<string, unknown>[];
      if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as Record<string, unknown>[];
      return [];
    },
  });
}


export const getInventoryItems = moduleLoader("/api/v1/inventory/items", "inventory.items");
export const getTelephonyCalls = moduleLoader("/api/v1/telephony/calls", "telephony.calls");
export const getLocations = moduleLoader("/api/v1/locations", "locations.list");
export const getNotificationTemplates = moduleLoader("/api/notification/templates", "notifications.templates");
export const getGrantSchemes = moduleLoader("/api/v1/grants/schemes", "grants.schemes");
export const getGrantInstallmentsLegacy = moduleLoader("/api/v1/grants/installments", "grants.installments");
export const getEstabFilesLegacy = moduleLoader("/api/v1/estab/files", "estab.files");
export const getKnowledgeDocuments = moduleLoader("/api/v1/knowledge/documents", "knowledge.documents");
export const getWorkflowInstances = moduleLoader("/api/v1/workflow/instances", "workflow.instances");
export const getAnalyticsDashboards = moduleLoader("/api/v1/analytics/dashboards", "analytics.dashboards");

// Finance loaders

function mapFinanceDashboard(payload: unknown): FinanceDashboard | null {
  if (!isRecord(payload)) return null;
  return {
    budgetUtilisationPct: typeof payload.budgetUtilisationPct === "number" ? payload.budgetUtilisationPct : 0,
    pendingSanctions: typeof payload.pendingSanctions === "number" ? payload.pendingSanctions : 0,
    paymentsThisMonth: typeof payload.paymentsThisMonth === "number" ? payload.paymentsThisMonth : 0,
    totalExpenditure: typeof payload.totalExpenditure === "number" ? payload.totalExpenditure : 0,
  };
}

const FINANCE_DASHBOARD_EMPTY: FinanceDashboard = {
  budgetUtilisationPct: 0,
  pendingSanctions: 0,
  paymentsThisMonth: 0,
  totalExpenditure: 0,
};

export async function getFinanceDashboard(): Promise<LoaderResult<FinanceDashboard>> {
  return fetchJson<unknown, FinanceDashboard>("/api/v1/finance/dashboard", FINANCE_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "finance.dashboard",
    responseSchema: FinanceDashboardSchema,
    mapResponse: mapFinanceDashboard,
  });
}

export async function getFinanceBudgets(): Promise<LoaderResult<BudgetSummary[]>> {
  return fetchJson<unknown, BudgetSummary[]>("/api/v1/finance/budgets", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.budgets",
    responseSchema: BudgetSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as BudgetSummary[] | null,
  });
}

export async function getFinanceSanctions(): Promise<LoaderResult<SanctionSummary[]>> {
  return fetchJson<unknown, SanctionSummary[]>("/api/v1/finance/sanctions", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.sanctions",
    responseSchema: SanctionSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as SanctionSummary[] | null,
  });
}

export async function getFinanceSanctionById(id: string): Promise<LoaderResult<SanctionDetail | null>> {
  return fetchJson<unknown, SanctionDetail | null>(`/api/v1/finance/sanctions/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.sanction.detail",
    responseSchema: SanctionDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as SanctionDetail) : null),
  });
}

export async function getFinanceBills(): Promise<LoaderResult<BillSummary[]>> {
  return fetchJson<unknown, BillSummary[]>("/api/v1/finance/bills", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.bills",
    responseSchema: BillSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as BillSummary[] | null,
  });
}

export async function getFinanceBillById(id: string): Promise<LoaderResult<BillDetail | null>> {
  return fetchJson<unknown, BillDetail | null>(`/api/v1/finance/bills/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.bill.detail",
    responseSchema: BillDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as BillDetail) : null),
  });
}

export async function getFinanceAdvances(): Promise<LoaderResult<AdvanceSummary[]>> {
  return fetchJson<unknown, AdvanceSummary[]>("/api/v1/finance/advances", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.advances",
    responseSchema: AdvanceSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AdvanceSummary[] | null,
  });
}

export async function getFinanceUCs(): Promise<LoaderResult<UCSummary[]>> {
  return fetchJson<unknown, UCSummary[]>("/api/v1/finance/utilization-certificates", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.ucs",
    responseSchema: UCSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as UCSummary[] | null,
  });
}

export async function getFinanceGLEntries(): Promise<LoaderResult<GLEntrySummary[]>> {
  return fetchJson<unknown, GLEntrySummary[]>("/api/v1/finance/journals", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.gl",
    responseSchema: GLEntrySummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as GLEntrySummary[] | null,
  });
}

export async function getFinancialStatements(fy?: string): Promise<LoaderResult<FinancialStatementSummary[]>> {
  const qs = fy ? `?fy=${encodeURIComponent(fy)}` : "";
  return fetchJson<unknown, FinancialStatementSummary[]>(`/api/v1/finance/statements${qs}`, [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.statements",
    responseSchema: FinancialStatementSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinancialStatementSummary[] | null,
  });
}

// ─── Finance: Treasury & Banking ─────────────────────────────────────────────

export async function getFinancePFMSScrolls(): Promise<LoaderResult<PfmsBatchSummary[]>> {
  return fetchJson<unknown, PfmsBatchSummary[]>("/api/v1/finance/pfms/batches", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.pfms.scrolls",
    responseSchema: PfmsBatchSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as PfmsBatchSummary[] | null,
  });
}

export async function getFinanceCashBook(): Promise<LoaderResult<CashBookEntry[]>> {
  return fetchJson<unknown, CashBookEntry[]>("/api/v1/finance/cash-book", [], {
    revalidateSeconds: 30,
    telemetryKey: "finance.cashbook",
    responseSchema: CashBookEntryListSchema,
    mapResponse: (p) => getArrayPayload(p) as CashBookEntry[] | null,
  });
}

export async function getFinanceDeposits(): Promise<LoaderResult<FinanceDepositSummary[]>> {
  return fetchJson<unknown, FinanceDepositSummary[]>("/api/v1/finance/deposits", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.deposits",
    responseSchema: FinanceDepositSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceDepositSummary[] | null,
  });
}

export async function getFinanceCheques(): Promise<LoaderResult<FinanceInstrumentSummary[]>> {
  return fetchJson<unknown, FinanceInstrumentSummary[]>("/api/v1/finance/instruments", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.cheques",
    responseSchema: FinanceInstrumentSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceInstrumentSummary[] | null,
  });
}

export async function getFinanceChequeById(id: string): Promise<LoaderResult<FinanceInstrumentSummary | null>> {
  return fetchJson<unknown, FinanceInstrumentSummary | null>(`/api/v1/finance/instruments/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.cheque.detail",
    responseSchema: FinanceInstrumentSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceInstrumentSummary) : null),
  });
}

// NOTE: this hits the exact same endpoint as getPayments() above (both call
// GET /api/v1/finance/payments), so it reuses that loader's established
// PaymentSummary/paymentsListSchema/mapPayments contract rather than
// inventing a second, possibly-divergent shape for the same wire data.
export async function getFinanceEPayments(): Promise<LoaderResult<PaymentSummary[]>> {
  return fetchJson("/api/v1/finance/payments", [] as PaymentSummary[], {
    revalidateSeconds: 60,
    telemetryKey: "finance.epayments",
    responseSchema: paymentsListSchema,
    mapResponse: mapPayments,
  });
}

// ─── Finance: Revenue & Receipts ─────────────────────────────────────────────

export async function getFinanceChallans(): Promise<LoaderResult<FinanceChallanSummary[]>> {
  return fetchJson<unknown, FinanceChallanSummary[]>("/api/v1/finance/challans", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.challans",
    responseSchema: FinanceChallanSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceChallanSummary[] | null,
  });
}

export async function getFinanceChallanById(id: string): Promise<LoaderResult<FinanceChallanSummary | null>> {
  return fetchJson<unknown, FinanceChallanSummary | null>(`/api/v1/finance/challans/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.challan.detail",
    responseSchema: FinanceChallanSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceChallanSummary) : null),
  });
}

// ─── Finance: Expenditure ────────────────────────────────────────────────────

export async function getFinanceGuarantees(): Promise<LoaderResult<FinanceGuaranteeSummary[]>> {
  return fetchJson<unknown, FinanceGuaranteeSummary[]>("/api/v1/finance/guarantees", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.guarantees",
    responseSchema: FinanceGuaranteeSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceGuaranteeSummary[] | null,
  });
}

export async function getFinanceSchemes(): Promise<LoaderResult<FinanceSchemeSummary[]>> {
  return fetchJson<unknown, FinanceSchemeSummary[]>("/api/v1/finance/schemes", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.schemes",
    responseSchema: FinanceSchemeSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceSchemeSummary[] | null,
  });
}

export async function getFinanceSchemeById(id: string): Promise<LoaderResult<FinanceSchemeSummary | null>> {
  return fetchJson<unknown, FinanceSchemeSummary | null>(`/api/v1/finance/schemes/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "finance.scheme.detail",
    responseSchema: FinanceSchemeSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceSchemeSummary) : null),
  });
}

// ─── Finance: Budget ─────────────────────────────────────────────────────────

export async function getFinanceDemandGrants(): Promise<LoaderResult<FinanceDemandSummary[]>> {
  return fetchJson<unknown, FinanceDemandSummary[]>("/api/v1/finance/budgets/demand-grants", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.demand-grants",
    responseSchema: FinanceDemandSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceDemandSummary[] | null,
  });
}

export async function getFinanceOutcomeBudget(): Promise<LoaderResult<BudgetOutcomeSummary[]>> {
  return fetchJson<unknown, BudgetOutcomeSummary[]>("/api/v1/finance/budget-outcomes", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.outcome-budget",
    responseSchema: BudgetOutcomeSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as BudgetOutcomeSummary[] | null,
  });
}

export async function getFinanceAllocations(): Promise<LoaderResult<FinanceBudgetAllocationSummary[]>> {
  return fetchJson<unknown, FinanceBudgetAllocationSummary[]>("/api/v1/finance/budget-allocations", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.allocations",
    responseSchema: FinanceBudgetAllocationSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceBudgetAllocationSummary[] | null,
  });
}


const BUDGET_MONITORING_EMPTY: BudgetMonitoringSummary = {
  fy: "",
  fractionElapsedBps: "0",
  totals: {
    count: 0,
    allocatedMinor: "0",
    committedMinor: "0",
    actualMinor: "0",
    availableMinor: "0",
    forecastYearEndMinor: "0",
    exceptions: {},
  },
};

export async function getFinanceBudgetMonitoring(fy?: string): Promise<LoaderResult<BudgetMonitoringSummary>> {
  const url = fy
    ? `/api/v1/finance/budget-monitoring/summary?fy=${encodeURIComponent(fy)}`
    : "/api/v1/finance/budget-monitoring/summary";
  return fetchJson<unknown, BudgetMonitoringSummary>(url, BUDGET_MONITORING_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "finance.budget-monitoring",
    responseSchema: BudgetMonitoringSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as BudgetMonitoringSummary) : null),
  });
}

export async function getFinanceBudgetMonitoringLines(fy?: string): Promise<LoaderResult<BudgetMonitoringLine[]>> {
  const url = fy
    ? `/api/v1/finance/budget-monitoring?fy=${encodeURIComponent(fy)}`
    : "/api/v1/finance/budget-monitoring";
  return fetchJson<unknown, BudgetMonitoringLine[]>(url, [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.budget-monitoring-lines",
    responseSchema: BudgetMonitoringLinesResponseSchema,
    mapResponse: (p) => {
      const obj = p as BudgetMonitoringLinesResponse;
      return Array.isArray(obj.lines) ? obj.lines : null;
    },
  });
}

export async function getFinanceFundReleases(fy?: string): Promise<LoaderResult<AllocationDistributionSummary[]>> {
  const url = fy
    ? `/api/v1/finance/allocation-distributions?fy=${encodeURIComponent(fy)}`
    : "/api/v1/finance/allocation-distributions";
  return fetchJson<unknown, AllocationDistributionSummary[]>(url, [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.fund-releases",
    responseSchema: AllocationDistributionSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AllocationDistributionSummary[] | null,
  });
}

// ─── Finance: Vendors & Masters ──────────────────────────────────────────────

export async function getFinanceVendors(): Promise<LoaderResult<FinanceVendorSummary[]>> {
  return fetchJson<unknown, FinanceVendorSummary[]>("/api/v1/finance/vendors", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.vendors",
    responseSchema: FinanceVendorSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceVendorSummary[] | null,
  });
}

export async function getFinanceVendorById(id: string): Promise<LoaderResult<FinanceVendorDetail | null>> {
  return fetchJson<unknown, FinanceVendorDetail | null>(`/api/v1/finance/vendors/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "finance.vendor.detail",
    responseSchema: FinanceVendorDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceVendorDetail) : null),
  });
}

// ─── Finance: Statutory & Compliance ─────────────────────────────────────────

// NOTE: the frontend path says "tds/returns" but the backend module is
// vendor-tds; the /form-26q endpoint returns one consolidated report object
// per fy+quarter (not a list), while this plain vendor-tds ledger returns
// per-row entries whose `status` enum literally includes "filed" — matching
// this loader's consumer, which filters rows by status==="filed" and groups
// by row.quarter. That per-row shape is the better fit for a "returns list".
export async function getFinanceTDSReturns(): Promise<LoaderResult<VendorTdsEntry[]>> {
  return fetchJson<unknown, VendorTdsEntry[]>("/api/v1/finance/vendor-tds", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.tds-returns",
    responseSchema: VendorTdsEntryListSchema,
    mapResponse: (p) => getArrayPayload(p) as VendorTdsEntry[] | null,
  });
}

// ─── Finance: Audit & Debt ───────────────────────────────────────────────────

export async function getFinanceAuditParas(): Promise<LoaderResult<FinanceAuditParaSummary[]>> {
  return fetchJson<unknown, FinanceAuditParaSummary[]>("/api/v1/finance/audit-paras", [], {
    revalidateSeconds: 120,
    telemetryKey: "finance.audit-paras",
    responseSchema: FinanceAuditParaSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceAuditParaSummary[] | null,
  });
}

export async function getFinanceAuditParaById(id: string): Promise<LoaderResult<FinanceAuditParaSummary | null>> {
  return fetchJson<unknown, FinanceAuditParaSummary | null>(`/api/v1/finance/audit-paras/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "finance.audit-para.detail",
    responseSchema: FinanceAuditParaSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceAuditParaSummary) : null),
  });
}

export async function getFinanceDebt(): Promise<LoaderResult<FinanceDebtSummary[]>> {
  return fetchJson<unknown, FinanceDebtSummary[]>("/api/v1/finance/debt", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.debt",
    responseSchema: FinanceDebtSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceDebtSummary[] | null,
  });
}

// HR loaders

const HR_DASHBOARD_EMPTY: HRDashboard = {
  headcount: 0,
  headcountLastMonth: 0,
  attendanceTodayPct: 0,
  pendingLeaves: 0,
  onLeave: 0,
  payrollDue: 0,
  departmentBreakdown: [],
};

function mapHRDashboard(payload: unknown): HRDashboard | null {
  if (!isRecord(payload)) return null;
  const raw = payload as Record<string, unknown>;
  return {
    headcount: typeof raw.headcount === "number" ? raw.headcount : 0,
    headcountLastMonth: typeof raw.headcountLastMonth === "number" ? raw.headcountLastMonth : 0,
    attendanceTodayPct: typeof raw.attendanceTodayPct === "number" ? raw.attendanceTodayPct : 0,
    pendingLeaves: typeof raw.pendingLeaves === "number" ? raw.pendingLeaves : 0,
    onLeave: typeof raw.onLeave === "number" ? raw.onLeave : 0,
    payrollDue: typeof raw.payrollDue === "number" ? raw.payrollDue : 0,
    departmentBreakdown: Array.isArray(raw.departmentBreakdown)
      ? (raw.departmentBreakdown as { name: string; count: number }[])
      : [],
  };
}

export async function getDashboardLeaveInbox(): Promise<{ data: LeaveInboxItem[] }> {
  try {
    const res = await fetchJson<unknown, { data: LeaveInboxItem[] }>(
      "/api/v1/hrms/dashboard/pending-leaves",
      { data: [] as LeaveInboxItem[] },
      {
        revalidateSeconds: 30,
        telemetryKey: "hr.dashboard.pending_leaves",
        mapResponse: (p) => {
          if (!isRecord(p) || !Array.isArray(p.data)) return { data: [] as LeaveInboxItem[] };
          return { data: p.data as LeaveInboxItem[] };
        },
      }
    );
    return res.data;
  } catch {
    return { data: [] };
  }
}

export async function getHRDashboard(): Promise<LoaderResult<HRDashboard>> {
  return fetchJson<unknown, HRDashboard>("/api/v1/hrms/dashboard", HR_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "hr.dashboard",
    responseSchema: HRDashboardSchema,
    mapResponse: mapHRDashboard,
  });
}

export async function getAttendanceList(): Promise<LoaderResult<AttendanceSummaryItem[]>> {
  return fetchJson<unknown, AttendanceSummaryItem[]>("/api/v1/hrms/attendance", [], {
    revalidateSeconds: 60,
    telemetryKey: "hr.attendance.list",
    responseSchema: AttendanceSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AttendanceSummaryItem[] | null,
  });
}

export async function getAttendanceRegularisations(): Promise<LoaderResult<AttendanceRegularisation[]>> {
  return fetchJson<unknown, AttendanceRegularisation[]>("/api/v1/hrms/attendance/regularisations", [], {
    revalidateSeconds: 60,
    telemetryKey: "hr.attendance.regularisations",
    responseSchema: AttendanceRegularisationListSchema,
    mapResponse: (p) => getArrayPayload(p) as AttendanceRegularisation[] | null,
  });
}

export async function getLeaveRequestDetails(): Promise<LoaderResult<LeaveRequestDetail[]>> {
  return fetchJson<unknown, LeaveRequestDetail[]>("/api/v1/hrms/leave-requests", [], {
    revalidateSeconds: 60,
    telemetryKey: "hr.leave.details",
    responseSchema: LeaveRequestDetailListSchema,
    mapResponse: (p) => getArrayPayload(p) as LeaveRequestDetail[] | null,
  });
}

export async function getPayrollRunDetails(): Promise<LoaderResult<PayrollRunDetail[]>> {
  return fetchJson<unknown, PayrollRunDetail[]>("/api/v1/payroll/runs", [], {
    revalidateSeconds: 120,
    telemetryKey: "hr.payroll.runs.detail",
    responseSchema: PayrollRunDetailListSchema,
    mapResponse: (p) => getArrayPayload(p) as PayrollRunDetail[] | null,
  });
}

export async function getPayrollRunById(id: string): Promise<LoaderResult<PayrollRunFullDetail | null>> {
  return fetchJson<unknown, PayrollRunFullDetail | null>(`/api/v1/payroll/runs/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "hr.payroll.run.detail",
    responseSchema: PayrollRunFullDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as PayrollRunFullDetail) : null),
  });
}

export async function getPayrollStructures(): Promise<LoaderResult<PayrollStructure[]>> {
  return fetchJson<unknown, PayrollStructure[]>("/api/v1/payroll/structures", [], {
    revalidateSeconds: 300,
    telemetryKey: "hr.payroll.structures",
    responseSchema: PayrollStructureListSchema,
    mapResponse: (p) => getArrayPayload(p) as PayrollStructure[] | null,
  });
}

export async function getSalarySlips(limit = 50, offset = 0): Promise<LoaderResult<SalarySlipSummary[]>> {
  return fetchJson<unknown, SalarySlipSummary[]>(`/api/v1/payroll/salary-slips?limit=${limit}&offset=${offset}`, [], {
    revalidateSeconds: 120,
    telemetryKey: "hr.salary-slips",
    responseSchema: SalarySlipSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as SalarySlipSummary[] | null,
  });
}

export async function getJobOpenings(): Promise<LoaderResult<JobOpeningSummary[]>> {
  return fetchJson<unknown, JobOpeningSummary[]>("/api/v1/hrms/job-openings", [], {
    revalidateSeconds: 120,
    telemetryKey: "hr.recruitment",
    responseSchema: JobOpeningSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as JobOpeningSummary[] | null,
  });
}

export async function getAppraisals(): Promise<LoaderResult<AppraisalSummary[]>> {
  return fetchJson<unknown, AppraisalSummary[]>("/api/v1/hrms/appraisals", [], {
    revalidateSeconds: 120,
    telemetryKey: "hr.appraisals",
    responseSchema: AppraisalSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AppraisalSummary[] | null,
  });
}

export async function getTrainingPrograms(): Promise<LoaderResult<TrainingProgramSummary[]>> {
  return fetchJson<unknown, TrainingProgramSummary[]>("/api/v1/hrms/training-programs", [], {
    revalidateSeconds: 300,
    telemetryKey: "hr.training",
    responseSchema: TrainingProgramSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as TrainingProgramSummary[] | null,
  });
}

export async function getOrgChart(): Promise<LoaderResult<OrgChartNode[]>> {
  return fetchJson<unknown, OrgChartNode[]>("/api/v1/hrms/org-chart", [], {
    revalidateSeconds: 600,
    telemetryKey: "hr.orgchart",
    responseSchema: OrgChartSchema,
    mapResponse: (p) => getArrayPayload(p) as OrgChartNode[] | null,
  });
}

export async function getEmployeeById(id: string): Promise<LoaderResult<EmployeeDetail | null>> {
  return fetchJson<unknown, EmployeeDetail | null>(`/api/v1/hrms/employees/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "hr.employee.detail",
    responseSchema: EmployeeDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as EmployeeDetail) : null),
  });
}

// Procurement loaders

const PROCUREMENT_DASHBOARD_EMPTY: ProcurementDashboard = {
  pendingIndents: 0,
  activePOs: 0,
  grnsThisMonth: 0,
  contractRenewalsDue: 0,
};

export async function getProcurementDashboard(): Promise<LoaderResult<ProcurementDashboard>> {
  return fetchJson<unknown, ProcurementDashboard>("/api/v1/procurement/dashboard", PROCUREMENT_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "procurement.dashboard",
    responseSchema: ProcurementDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ProcurementDashboard) : null),
  });
}

export type ProcurementListQuery = {
  limit?: number;
  offset?: number;
  q?: string;
};

function buildListPath(base: string, query?: ProcurementListQuery): string {
  if (!query) return base;
  const params = new URLSearchParams();
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.offset != null) params.set("offset", String(query.offset));
  if (query.q?.trim()) params.set("q", query.q.trim());
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function filterByQuery<T>(rows: T[], q: string | undefined, match: (row: T, needle: string) => boolean): T[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => match(row, needle));
}

export async function getProcurementIndents(query?: ProcurementListQuery): Promise<LoaderResult<IndentSummary[]>> {
  const path = buildListPath("/api/v1/procurement/indents", query);
  const result = await fetchJson<unknown, IndentSummary[]>(path, [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.indents",
    mapResponse: mapProcurementIndentSummaries,
  });
  if (!result.data || !query?.q) return result;
  return {
    ...result,
    data: filterByQuery(result.data, query.q, (row, needle) =>
      row.indentNo.toLowerCase().includes(needle)
      || row.department.toLowerCase().includes(needle)
      || row.requestedBy.toLowerCase().includes(needle)),
  };
}

export async function getProcurementIndentById(id: string): Promise<LoaderResult<IndentDetail | null>> {
  return fetchJson<unknown, IndentDetail | null>(`/api/v1/procurement/indents/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.indent.detail",
    mapResponse: mapProcurementIndentDetail,
  });
}

export async function getProcurementVendors(query?: ProcurementListQuery): Promise<LoaderResult<VendorDetail[]>> {
  const path = buildListPath("/api/v1/procurement/vendors", query);
  const result = await fetchJson<unknown, VendorDetail[]>(path, [], {
    revalidateSeconds: 300,
    telemetryKey: "procurement.vendors.detail",
    mapResponse: mapProcurementVendorDetails,
  });
  if (!result.data || !query?.q) return result;
  return {
    ...result,
    data: filterByQuery(result.data, query.q, (row, needle) =>
      row.name.toLowerCase().includes(needle)
      || (row.gstin?.toLowerCase().includes(needle) ?? false)
      || row.category.toLowerCase().includes(needle)),
  };
}

export async function getProcurementVendorById(id: string): Promise<LoaderResult<VendorDetail | null>> {
  return fetchJson<unknown, VendorDetail | null>(`/api/v1/procurement/vendors/${id}`, null, {
    revalidateSeconds: 120,
    telemetryKey: "procurement.vendor.detail",
    mapResponse: mapProcurementVendorDetail,
  });
}

export async function getRFQs(): Promise<LoaderResult<RFQSummary[]>> {
  return fetchJson<unknown, RFQSummary[]>("/api/v1/procurement/rfqs", [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.rfqs",
    responseSchema: RFQSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as RFQSummary[] | null,
  });
}

export async function getRFQById(id: string): Promise<LoaderResult<RFQDetail | null>> {
  return fetchJson<unknown, RFQDetail | null>(`/api/v1/procurement/rfqs/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.rfq.detail",
    responseSchema: RFQDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as RFQDetail) : null),
  });
}

export async function getProcurementGRNs(query?: ProcurementListQuery): Promise<LoaderResult<GRNSummary[]>> {
  const path = buildListPath("/api/v1/procurement/grns", query);
  const result = await fetchJson<unknown, GRNSummary[]>(path, [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.grns",
    responseSchema: GRNSummaryListSchema,
    mapResponse: mapProcurementGRNSummaries,
  });
  if (!result.data || !query?.q) return result;
  return {
    ...result,
    data: filterByQuery(result.data, query.q, (row, needle) =>
      row.grnNo.toLowerCase().includes(needle)
      || row.poRef.toLowerCase().includes(needle)
      || row.vendor.toLowerCase().includes(needle)),
  };
}

export async function getProcurementGRNById(id: string): Promise<LoaderResult<GRNDetail | null>> {
  return fetchJson<unknown, GRNDetail | null>(`/api/v1/procurement/grns/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.grn.detail",
    mapResponse: mapProcurementGRNDetail,
  });
}

/** Store Receipt Note for a GRN — inventory-service, gates payment on the three-way-match consumer. */
export async function getSrnByGrn(grnId: string): Promise<LoaderResult<SrnDetail | null>> {
  return fetchJson<unknown, SrnDetail | null>(`/api/v1/inventory/srn/${grnId}`, null, {
    revalidateSeconds: 15,
    telemetryKey: "inventory.srn.byGrn",
    mapResponse: (p) => {
      const data = isRecord(p) && "data" in p ? (p as { data: unknown }).data : null;
      return data ? mapSrnDetail(data) : null;
    },
  });
}

/** Single goods return (item back from issue) awaiting/undergoing QC — inventory-service. */
export async function getGoodsReturnById(id: string): Promise<LoaderResult<GoodsReturnDetail | null>> {
  return fetchJson<unknown, GoodsReturnDetail | null>(`/api/v1/inventory/goods-returns/${id}`, null, {
    revalidateSeconds: 15,
    telemetryKey: "inventory.goodsReturn.detail",
    mapResponse: (p) => {
      const data = isRecord(p) && "data" in p ? (p as { data: unknown }).data : null;
      return data ? mapGoodsReturnDetail(data) : null;
    },
  });
}

/** Cycle count detail — inventory-service, supervisor approve/reject workflow. */
export async function getCycleCountById(id: string): Promise<LoaderResult<CycleCountDetail | null>> {
  return fetchJson<unknown, CycleCountDetail | null>(`/api/v1/inventory/cycle-counts/${id}`, null, {
    revalidateSeconds: 15,
    telemetryKey: "inventory.cycleCount.detail",
    mapResponse: (p) => {
      const data = isRecord(p) && "data" in p ? (p as { data: unknown }).data : null;
      return data ? mapCycleCountDetail(data) : null;
    },
  });
}

export async function getProcurementTenders(): Promise<LoaderResult<TenderSummary[]>> {
  return fetchJson<unknown, TenderSummary[]>("/api/v1/procurement/tenders", [], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.tenders",
    responseSchema: TenderSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as TenderSummary[] | null,
  });
}

export async function getProcurementTenderById(id: string): Promise<LoaderResult<TenderDetail | null>> {
  return fetchJson<unknown, TenderDetail | null>(`/api/v1/procurement/tenders/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "procurement.tender.detail",
    responseSchema: TenderDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as TenderDetail) : null),
  });
}

export async function getProcurementPOs(query?: ProcurementListQuery): Promise<LoaderResult<PurchaseOrderListItem[]>> {
  const path = buildListPath("/api/v1/procurement/pos", query);
  const result = await fetchJson<unknown, PurchaseOrderListItem[]>(path, [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.pos",
    mapResponse: mapProcurementPOListItems,
  });
  if (!result.data || !query?.q) return result;
  return {
    ...result,
    data: filterByQuery(result.data, query.q, (row, needle) =>
      row.poNo.toLowerCase().includes(needle)
      || row.vendor.toLowerCase().includes(needle)),
  };
}

export async function getProcurementPOById(id: string): Promise<LoaderResult<PODetail | null>> {
  return fetchJson<unknown, PODetail | null>(`/api/v1/procurement/pos/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "procurement.po.detail",
    mapResponse: mapProcurementPODetail,
  });
}

// Procurement — Bid Evaluation, Reverse Auction, GeM, EMD/BG, Empanelment, Pre-Bid

export type BidEvaluation = {
  id: string;
  tender: string;
  bidder: string;
  technicalScore: number;
  financialScore: number;
  totalScore: number;
  rank: number;
  status: string;
};

export async function getProcurementBidEvaluations(): Promise<LoaderResult<BidEvaluation[]>> {
  return fetchJson<unknown, BidEvaluation[]>("/api/v1/procurement/bid-evaluations", [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.bid_evaluations",
    mapResponse: (p) => getArrayPayload(p) as BidEvaluation[] | null,
  });
}

export type ReverseAuction = {
  id: string;
  item: string;
  startPrice: number;
  currentLowest: number;
  bidders: number;
  timeRemaining: string;
  status: string;
};

export async function getProcurementReverseAuctions(): Promise<LoaderResult<ReverseAuction[]>> {
  return fetchJson<unknown, ReverseAuction[]>("/api/v1/procurement/reverse-auctions", [], {
    revalidateSeconds: 30,
    telemetryKey: "procurement.reverse_auctions",
    mapResponse: (p) => getArrayPayload(p) as ReverseAuction[] | null,
  });
}

export type GemItem = {
  id: string;
  orderId: string;
  item: string;
  supplier: string;
  amount: number;
  deliveryDate: string;
  gemStatus: string;
};

export async function getProcurementGem(): Promise<LoaderResult<GemItem[]>> {
  return fetchJson<unknown, GemItem[]>("/api/v1/procurement/gem/items", [], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.gem",
    mapResponse: (p) => getArrayPayload(p) as GemItem[] | null,
  });
}

export type EmdBgEntry = {
  id: string;
  vendor: string;
  type: string;
  amount: number;
  validity: string;
  bank: string;
  status: string;
};

export async function getProcurementEMD(): Promise<LoaderResult<EmdBgEntry[]>> {
  return fetchJson<unknown, EmdBgEntry[]>("/api/v1/procurement/emd", [], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.emd_bg",
    mapResponse: (p) => getArrayPayload(p) as EmdBgEntry[] | null,
  });
}

/** Performance security (bank guarantees) — same register the EMD & BG page renders alongside EMD entries. */
export async function getProcurementPBG(): Promise<LoaderResult<EmdBgEntry[]>> {
  return fetchJson<unknown, EmdBgEntry[]>("/api/v1/procurement/pbg", [], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.pbg",
    mapResponse: (p) => getArrayPayload(p) as EmdBgEntry[] | null,
  });
}

export type EmpanelmentEntry = {
  id: string;
  vendorName: string;
  category: string;
  validUntil: string;
  rating: number;
  status: string;
};

export async function getProcurementEmpanelment(): Promise<LoaderResult<EmpanelmentEntry[]>> {
  return fetchJson<unknown, EmpanelmentEntry[]>("/api/v1/procurement/empanelment", [], {
    revalidateSeconds: 120,
    telemetryKey: "procurement.empanelment",
    mapResponse: (p) => getArrayPayload(p) as EmpanelmentEntry[] | null,
  });
}

export type PreBidConference = {
  id: string;
  tender: string;
  date: string;
  queriesRaised: number;
  responses: number;
  attendees: number;
  status: string;
};

export async function getProcurementPreBid(): Promise<LoaderResult<PreBidConference[]>> {
  return fetchJson<unknown, PreBidConference[]>("/api/v1/procurement/pre-bid-conferences", [], {
    revalidateSeconds: 60,
    telemetryKey: "procurement.pre_bid",
    mapResponse: (p) => getArrayPayload(p) as PreBidConference[] | null,
  });
}

// CRM dashboard + detail loaders

const CRM_DASHBOARD_EMPTY: CRMDashboard = {
  totalContacts: 0,
  openDeals: 0,
  activitiesToday: 0,
  pipelineValue: 0,
};

export async function getCRMDashboard(): Promise<LoaderResult<CRMDashboard>> {
  return fetchJson<unknown, CRMDashboard>("/api/v1/crm/dashboard", CRM_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "crm.dashboard",
    responseSchema: CRMDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as CRMDashboard) : null),
  });
}

function mapDeals(payload: unknown): DealSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: DealSummary[] = [];
  const validStages = new Set(["Lead", "Proposal", "Negotiation", "Won", "Lost"]);
  const validStatuses = new Set(["active", "won", "lost"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const dealName = toText(row.dealName) ?? toText(row.name);
    const stage = toText(row.stage);
    const status = toText(row.status) ?? "active";
    if (!id || !dealName || !stage || !validStages.has(stage)) continue;
    if (!validStatuses.has(status)) continue;
    mapped.push({
      id,
      dealName,
      contactId: toText(row.contactId) ?? undefined,
      contactName: toText(row.contactName) ?? undefined,
      stage: stage as DealSummary["stage"],
      amount: typeof row.amount === "number" ? row.amount : 0,
      owner: toText(row.owner) ?? "—",
      closeDate: toText(row.closeDate) ?? undefined,
      probability: typeof row.probability === "number" ? row.probability : 0,
      status: status as DealSummary["status"],
    });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getDeals(): Promise<LoaderResult<DealSummary[]>> {
  return fetchJson<unknown, DealSummary[]>("/api/v1/crm/deals", [], {
    revalidateSeconds: 60,
    telemetryKey: "crm.deals.full",
    mapResponse: mapDealSummaries,
  });
}

export async function getDealById(id: string): Promise<LoaderResult<DealSummary | null>> {
  // NOTE: deliberately not using DealSummarySchema as a responseSchema gate here —
  // its stage/status enums are stale relative to the real backend contract (which
  // returns Capitalized stage values like "Lead"/"Proposal"/"Won"), so every
  // parse used to fail and this endpoint always reported source:"error" /
  // Deal Not Found for every real deal. mapDealSummaries already normalizes that
  // same shape correctly for the deals list — reuse it here for a single row.
  return fetchJson<unknown, DealSummary | null>(`/api/v1/crm/deals/${id}`, null, {
    revalidateSeconds: 0,
    telemetryKey: "crm.deal.detail",
    mapResponse: (p) => {
      const mapped = mapDealSummaries(isRecord(p) ? [p] : null);
      return mapped && mapped[0] ? mapped[0] : null;
    },
  });
}

// ── CRM Pipeline (Kanban) loaders ─────────────────────────────────────────────

export type PipelineStageView = {
  id: string;
  name: string;
  probability: number;
  ordinal: number;
};

export type PipelineView = {
  id: string;
  name: string;
  stages: PipelineStageView[];
  status: string;
};

export type PipelineDealCard = {
  id: string;
  name: string;
  stageId: string | null;
  stage: string;
  valueMinor: string;
  valueDisplay: string;
  probability: number;
  ownerId: string | null;
  contactName: string | null;
  version: number;
  /** ML prediction data (present when lead scoring is active) */
  prediction?: {
    probability: number;
    confidence: number;
    factors?: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
    isFallback?: boolean;
  } | null;
};

function mapPipelines(payload: unknown): PipelineView[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: PipelineView[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    const status = toText(row.status) ?? "active";
    if (!id || !name) continue;
    const stages: PipelineStageView[] = [];
    const rawStages = Array.isArray(row.stages) ? row.stages : [];
    for (const s of rawStages) {
      if (!isRecord(s)) continue;
      const sid = toText(s.id);
      const sname = toText(s.name);
      if (!sid || !sname) continue;
      stages.push({
        id: sid,
        name: sname,
        probability: typeof s.probability === "number" ? s.probability : 0,
        ordinal: typeof s.ordinal === "number" ? s.ordinal : 0,
      });
    }
    stages.sort((a, b) => a.ordinal - b.ordinal);
    mapped.push({ id, name, stages, status });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getPipelines(): Promise<LoaderResult<PipelineView[]>> {
  return fetchJson<unknown, PipelineView[]>("/api/v1/crm/pipelines", [], {
    revalidateSeconds: 60,
    telemetryKey: "crm.pipelines",
    mapResponse: mapPipelines,
  });
}

function mapPipelineDeals(payload: unknown): PipelineDealCard[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: PipelineDealCard[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (!id || !name) continue;
    const predRaw = isRecord(row.prediction) ? row.prediction : null;
    mapped.push({
      id,
      name,
      stageId: toText(row.stageId) ?? null,
      stage: toText(row.stage) ?? "Lead",
      valueMinor: toText(row.valueMinor) ?? "0",
      valueDisplay: toText(row.valueDisplay) ?? "₹0.00",
      probability: typeof row.probability === "number" ? row.probability : 0,
      ownerId: toText(row.ownerId) ?? null,
      contactName: toText(row.contactName) ?? null,
      version: typeof row.version === "number" ? row.version : 1,
      prediction: predRaw ? {
        probability: typeof predRaw.probability === "number" ? predRaw.probability : 0,
        confidence: typeof predRaw.confidence === "number" ? predRaw.confidence : 0,
        factors: Array.isArray(predRaw.factors) ? predRaw.factors as Array<{ feature: string; contribution: number; direction: "positive" | "negative" }> : undefined,
        isFallback: predRaw.isFallback === true,
      } : undefined,
    });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getPipelineDeals(): Promise<LoaderResult<PipelineDealCard[]>> {
  return fetchJson<unknown, PipelineDealCard[]>("/api/v1/crm/deals?limit=200", [], {
    revalidateSeconds: 30,
    telemetryKey: "crm.pipeline.deals",
    mapResponse: mapPipelineDeals,
  });
}

const CHAT_LIST_OPTIONS = {
  revalidateSeconds: 0,
  telemetryKey: "ai.chat.conversations",
  responseSchema: chatConversationsListSchema,
  mapResponse: (payload: { data: ChatConversation[] }) => payload.data,
};

/** Assistant chat conversations, optionally narrowed to one status. */
export async function getChatConversations(
  status?: "active" | "handed_off" | "ended",
): Promise<LoaderResult<ChatConversation[]>> {
  if (status) {
    return fetchJson(`/api/v1/ai/chat?limit=100&status=${status}`, [] as ChatConversation[], CHAT_LIST_OPTIONS);
  }
  return fetchJson("/api/v1/ai/chat?limit=100", [] as ChatConversation[], CHAT_LIST_OPTIONS);
}

/**
 * A single conversation.
 *
 * ai-agent-service has no single-conversation read — only the list and the
 * transcript — so this selects from the list. Worth replacing with a dedicated
 * endpoint if the conversation count per tenant grows past a page.
 */
export async function getChatConversation(id: string): Promise<LoaderResult<ChatConversation | null>> {
  return fetchJson("/api/v1/ai/chat?limit=200", null as ChatConversation | null, {
    revalidateSeconds: 0,
    telemetryKey: "ai.chat.conversation",
    responseSchema: chatConversationsListSchema,
    mapResponse: (payload) => payload.data.find((c) => c.id === id) ?? null,
  });
}

/** Full transcript for one conversation, as returned by the service. */
export async function getChatTranscript(id: string): Promise<LoaderResult<ChatMessage[]>> {
  return fetchJson(`/api/v1/ai/chat/${id}/history?limit=200`, [] as ChatMessage[], {
    revalidateSeconds: 0,
    telemetryKey: "ai.chat.transcript",
    responseSchema: chatTranscriptSchema,
    mapResponse: (payload) => payload.data,
  });
}

/** Recent copilot turns for the tenant, newest first. */
export async function getCopilotTurns(): Promise<LoaderResult<CopilotTurn[]>> {
  return fetchJson("/api/v1/ai/copilot/turns?limit=50", [] as CopilotTurn[], {
    revalidateSeconds: 0,
    telemetryKey: "ai.copilot.turns",
    responseSchema: copilotTurnsListSchema,
    mapResponse: (payload) => payload.data.map((turn) => ({
      ...turn,
      sourceCitations: (turn.sourceCitations ?? []).map((citation) => ({
        ...citation,
        id: citation.id ?? "",
      })),
    })),
  });
}

/** A single copilot turn, including the service-classified latency bucket. */
export async function getCopilotTurn(id: string): Promise<LoaderResult<CopilotTurn | null>> {
  return fetchJson(`/api/v1/ai/copilot/turns/${id}`, null as CopilotTurn | null, {
    revalidateSeconds: 0,
    telemetryKey: "ai.copilot.turn",
    responseSchema: copilotTurnDetailSchema,
    mapResponse: (payload) => ({
      ...payload.data,
      latencyBucket: payload.data.latencyBucket ?? null,
      sourceCitations: (payload.data.sourceCitations ?? []).map((citation) => ({
        ...citation,
        id: citation.id ?? "",
      })),
    }),
  });
}

/**
 * Accounts scored at risk or critical by recommendation-service, worst first.
 * Account names are not part of this payload — the health screen joins them
 * from getCrmAccounts, since the two domains live in different services.
 */
export async function getAccountHealthWatchlist(): Promise<LoaderResult<AccountHealthEntry[]>> {
  return fetchJson("/api/v1/recommendations/health/at-risk?limit=100", [] as AccountHealthEntry[], {
    revalidateSeconds: 60,
    telemetryKey: "crm.health.watchlist",
    responseSchema: accountHealthWatchlistSchema,
    mapResponse: (payload) => payload.data,
  });
}

/**
 * Health breakdown for one account. Returns null when the account has never
 * been scored — a 404 here is an expected state, not a failure.
 */
export async function getAccountHealthBreakdown(
  accountId: string,
): Promise<LoaderResult<AccountHealthBreakdown | null>> {
  return fetchJson(
    `/api/v1/recommendations/health/${accountId}/breakdown`,
    null as AccountHealthBreakdown | null,
    {
      revalidateSeconds: 60,
      telemetryKey: "crm.health.breakdown",
      responseSchema: accountHealthBreakdownSchema,
      mapResponse: (payload) => payload.data,
    },
  );
}

const CRM_FORECAST_EMPTY: CRMForecast = { totalForecastMinor: "0", dealCount: 0, stages: [] };

const CRM_FORECAST_OPTIONS = {
  revalidateSeconds: 30,
  telemetryKey: "crm.forecast",
  responseSchema: crmForecastSchema,
  mapResponse: (payload: z.infer<typeof crmForecastSchema>): CRMForecast => ({
    totalForecastMinor: payload.data.totalForecast,
    dealCount: payload.data.dealCount,
    stages: payload.data.stages.map((stage) => ({
      stageId: stage.stageId,
      stageName: stage.stageName,
      probability: stage.probability,
      weightedTotalMinor: stage.weightedTotal,
    })),
  }),
};

/**
 * Weighted revenue forecast for active deals, optionally scoped to one pipeline.
 * The total is recomputed server-side from that pipeline's stage probabilities,
 * so the filter is a query parameter rather than a client-side narrowing.
 */
export async function getCrmForecast(pipelineId?: string): Promise<LoaderResult<CRMForecast>> {
  if (pipelineId) {
    return fetchJson(
      `/api/v1/crm/forecast?pipelineId=${encodeURIComponent(pipelineId)}`,
      CRM_FORECAST_EMPTY,
      CRM_FORECAST_OPTIONS,
    );
  }
  return fetchJson("/api/v1/crm/forecast", CRM_FORECAST_EMPTY, CRM_FORECAST_OPTIONS);
}

const CRM_VOC_EMPTY: CRMVocSummary = {
  total: 0,
  byPolarity: { positive: 0, neutral: 0, negative: 0 },
  averageScore: 0,
  negativeShare: 0,
  themes: [],
  truncated: false,
};

/**
 * Voice-of-Customer aggregate over scored interactions, optionally windowed.
 * The aggregate is computed server-side over the tenant's readings, so the date
 * window is a query parameter rather than a client-side narrowing of a page.
 */
export async function getCrmSentimentSummary(
  range: { from?: string; to?: string } = {},
): Promise<LoaderResult<CRMVocSummary>> {
  const qs = new URLSearchParams();
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  const path = qs.toString()
    ? `/api/v1/crm/sentiment/summary?${qs}`
    : "/api/v1/crm/sentiment/summary";

  return fetchJson(path, CRM_VOC_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "crm.sentiment.summary",
    responseSchema: crmVocSummarySchema,
    mapResponse: (payload: z.infer<typeof crmVocSummarySchema>): CRMVocSummary => ({
      total: payload.data.total,
      byPolarity: payload.data.byPolarity,
      averageScore: payload.data.averageScore,
      negativeShare: payload.data.negativeShare,
      themes: payload.data.topThemes,
      truncated: payload.data.truncated,
    }),
  });
}


/**
 * Campaign ROI across every campaign with recorded performance (P1-6).
 */

/** Public website lead-capture form registry (P1-7). */

/** Executive control tower (P2-8). */

/** A/B-MVT experiments (P2-9). */
export async function getNotificationExperiments(): Promise<LoaderResult<NotificationExperiment[]>> {
  return fetchJson("/api/v1/notification/experiments?limit=100&offset=0", [] as NotificationExperiment[], {
    revalidateSeconds: 30,
    telemetryKey: "notification.experiments",
    responseSchema: notificationExperimentListSchema,
    mapResponse: (payload) => payload.data,
  });
}

export async function getCrmControlTower(): Promise<LoaderResult<CRMControlTower | null>> {
  return fetchJson("/api/v1/crm/dashboard/control-tower", null as CRMControlTower | null, {
    revalidateSeconds: 60,
    telemetryKey: "crm.control_tower",
    responseSchema: crmControlTowerSchema,
    mapResponse: (payload) => payload.data,
  });
}

export async function getCrmLeadCaptureForms(): Promise<LoaderResult<CRMLeadCaptureForm[]>> {
  return fetchJson("/api/v1/crm/lead-capture-forms", [] as CRMLeadCaptureForm[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.lead_capture_forms",
    responseSchema: crmLeadCaptureFormSchema,
    mapResponse: (payload) => payload.data,
  });
}

export async function getCrmCampaignRoiSummary(): Promise<LoaderResult<CRMCampaignRoiSummaryRow[]>> {
  return fetchJson("/api/v1/crm/campaigns/roi-summary?limit=200", [] as CRMCampaignRoiSummaryRow[], {
    revalidateSeconds: 60,
    telemetryKey: "crm.campaign.roi_summary",
    responseSchema: crmCampaignRoiSummarySchema,
    mapResponse: (payload) => payload.data,
  });
}

/**
 * One campaign's totals and per-period breakdown. Returns null when the campaign
 * has no performance rows — the service answers 404 there, which is an expected
 * state for a campaign nobody has costed yet, not a failure.
 */
export async function getCrmCampaignRoi(id: string): Promise<LoaderResult<CRMCampaignRoi | null>> {
  return fetchJson(
    `/api/v1/crm/campaigns/${encodeURIComponent(id)}/roi`,
    null as CRMCampaignRoi | null,
    {
      revalidateSeconds: 60,
      telemetryKey: "crm.campaign.roi",
      responseSchema: crmCampaignRoiSchema,
      mapResponse: (payload) => payload.data,
    },
  );
}

export async function getContactById(id: string): Promise<LoaderResult<ContactDetail | null>> {
  return fetchJson<unknown, ContactDetail | null>(`/api/v1/crm/contacts/${id}/detail`, null, {
    revalidateSeconds: 60,
    telemetryKey: "crm.contact.detail",
    responseSchema: ContactDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ContactDetail) : null),
  });
}

function mapCRMActivityEntries(payload: unknown): CRMActivityEntry[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: CRMActivityEntry[] = [];
  const validTypes = new Set(["call", "meeting", "email", "task", "note"]);
  const validStatuses = new Set(["open", "overdue", "completed", "cancelled"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const type = toText(row.type) ?? "task";
    const subject = toText(row.subject) ?? toText(row.text);
    const owner = toText(row.owner) ?? toText(row.actorName) ?? toText(row.actor) ?? "—";
    const status = toText(row.status) ?? "open";
    if (!id || !subject) continue;
    if (!validTypes.has(type) || !validStatuses.has(status)) continue;
    mapped.push({
      id,
      type: type as CRMActivityEntry["type"],
      subject,
      relatedTo: toText(row.relatedTo) ?? undefined,
      relatedType: (["contact", "deal", "other"] as const).find((t) => t === row.relatedType),
      dueDate: toText(row.dueDate) ?? undefined,
      completedAt: toText(row.completedAt) ?? undefined,
      owner,
      status: status as CRMActivityEntry["status"],
    });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getCRMActivities(): Promise<LoaderResult<CRMActivityEntry[]>> {
  return fetchJson<unknown, CRMActivityEntry[]>("/api/v1/crm/activities", [], {
    revalidateSeconds: 60,
    telemetryKey: "crm.activities.full",
    responseSchema: CRMActivityEntryListSchema,
    mapResponse: mapCRMActivityEntries,
  });
}

// Helpdesk detail loaders

function mapTicketDetails(payload: unknown): TicketDetail[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: TicketDetail[] = [];
  const validPriorities = new Set(["low", "medium", "high", "critical"]);
  const validStatuses = new Set(["open", "in_progress", "pending", "resolved", "closed"]);
  const validSla = new Set(["within_sla", "due_soon", "breached"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const ticketNo = toText(row.ticketNo) ?? toText(row.id) ?? "";
    const subject = toText(row.subject) ?? toText(row.title);
    const requesterName = toText(row.requesterName) ?? toText(row.requester) ?? "—";
    const rawPriority = (toText(row.priority) ?? "medium").toLowerCase();
    const priority = validPriorities.has(rawPriority) ? rawPriority : "medium";
    const rawStatus = (toText(row.status) ?? "open").toLowerCase().replace(" ", "_");
    const status = validStatuses.has(rawStatus) ? rawStatus : "open";
    const rawSla = (toText(row.slaStatus) ?? "within_sla");
    const slaStatus = validSla.has(rawSla) ? rawSla : "within_sla";
    if (!id || !subject) continue;
    mapped.push({
      id,
      ticketNo,
      subject,
      description: toText(row.description) ?? undefined,
      requesterName,
      requesterEmail: toText(row.requesterEmail) ?? undefined,
      assignedTo: toText(row.assignedTo) ?? undefined,
      priority: priority as TicketDetail["priority"],
      slaStatus: slaStatus as TicketDetail["slaStatus"],
      status: status as TicketDetail["status"],
      channel: (["web", "email", "phone", "walk_in"] as const).find((c) => c === row.channel),
      createdAt: toText(row.createdAt) ?? new Date().toISOString(),
      updatedAt: toText(row.updatedAt) ?? new Date().toISOString(),
      resolvedAt: toText(row.resolvedAt) ?? undefined,
      comments: [],
    });
  }
  return mapped.length > 0 ? mapped : null;
}

export async function getHelpdeskTicketList(): Promise<LoaderResult<TicketDetail[]>> {
  return fetchJson<unknown, TicketDetail[]>("/api/v1/citizen/tickets", [], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.tickets.full",
    mapResponse: mapHelpdeskTicketList,
  });
}

export async function getHelpdeskTicketById(id: string): Promise<LoaderResult<TicketDetail | null>> {
  return fetchJson<unknown, TicketDetail | null>(`/api/v1/citizen/tickets/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.ticket.detail",
    mapResponse: mapHelpdeskTicketDetail,
  });
}

export async function getBreachedSLATickets(): Promise<LoaderResult<TicketDetail[]>> {
  return fetchJson<unknown, TicketDetail[]>("/api/v1/citizen/tickets?slaStatus=breached", [], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.sla.breached",
    responseSchema: TicketDetailListSchema,
    mapResponse: mapTicketDetails,
  });
}

const TICKET_ANALYTICS_EMPTY: TicketAnalytics = {
  totalTickets: 0,
  openTickets: 0,
  resolvedThisMonth: 0,
  slaBreachedCount: 0,
  avgResolutionHours: 0,
  byPriority: [],
  byChannel: [],
};

export async function getTicketAnalytics(): Promise<LoaderResult<TicketAnalytics>> {
  return fetchJson<unknown, TicketAnalytics>("/api/v1/citizen/tickets/analytics", TICKET_ANALYTICS_EMPTY, {
    revalidateSeconds: 300,
    telemetryKey: "helpdesk.analytics",
    responseSchema: TicketAnalyticsSchema,
    mapResponse: (p) => (isRecord(p) ? (p as TicketAnalytics) : null),
  });
}

// Citizen loaders

export async function getCitizenRequests(): Promise<LoaderResult<CitizenRequestSummary[]>> {
  return fetchJson<unknown, CitizenRequestSummary[]>("/api/v1/citizen/requests", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.requests",
    responseSchema: CitizenRequestSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as CitizenRequestSummary[] | null,
  });
}

export async function getRTIApplications(): Promise<LoaderResult<RTISummary[]>> {
  return fetchJson<unknown, RTISummary[]>("/api/v1/citizen/rti", [], {
    revalidateSeconds: 120,
    telemetryKey: "citizen.rti",
    responseSchema: RTISummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as RTISummary[] | null,
  });
}

// Citizen — Portal, Alerts, Notices, Surveys

export type CitizenPortalMetric = {
  id: string;
  metric: string;
  category: string;
  currentMonth: string;
  previousMonth: string;
  change: string;
  status: string;
};

export async function getCitizenPortal(): Promise<LoaderResult<CitizenPortalMetric[]>> {
  return fetchJson<unknown, CitizenPortalMetric[]>("/api/v1/citizen/portal/metrics", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.portal",
    mapResponse: (p) => getArrayPayload(p) as CitizenPortalMetric[] | null,
  });
}

export type CitizenAlert = {
  id: string;
  title: string;
  category: string;
  publishedDate: string;
  targetAudience: string;
  status: string;
};

export async function getCitizenAlerts(): Promise<LoaderResult<CitizenAlert[]>> {
  return fetchJson<unknown, CitizenAlert[]>("/api/v1/citizen/alerts", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.alerts",
    mapResponse: (p) => getArrayPayload(p) as CitizenAlert[] | null,
  });
}

export type CitizenNotice = {
  id: string;
  noticeNo: string;
  subject: string;
  department: string;
  published: string;
  expiry: string;
  type: string;
};

export async function getCitizenNotices(): Promise<LoaderResult<CitizenNotice[]>> {
  return fetchJson<unknown, CitizenNotice[]>("/api/v1/citizen/notices", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.notices",
    mapResponse: (p) => getArrayPayload(p) as CitizenNotice[] | null,
  });
}

export type CitizenSurvey = {
  id: string;
  surveyName: string;
  responses: number;
  completion: string;
  period: string;
  status: string;
};

export async function getCitizenSurveys(): Promise<LoaderResult<CitizenSurvey[]>> {
  return fetchJson<unknown, CitizenSurvey[]>("/api/v1/citizen/surveys", [], {
    revalidateSeconds: 60,
    telemetryKey: "citizen.surveys",
    mapResponse: (p) => getArrayPayload(p) as CitizenSurvey[] | null,
  });
}

// Projects loaders

const PROJECTS_DASHBOARD_EMPTY: ProjectsDashboard = {
  totalProjects: 0,
  onTrackPct: 0,
  delayed: 0,
  totalOutlay: 0,
};

export async function getProjectsDashboard(): Promise<LoaderResult<ProjectsDashboard>> {
  return fetchJson<unknown, ProjectsDashboard>("/api/v1/project/dashboard", PROJECTS_DASHBOARD_EMPTY, {
    revalidateSeconds: 120,
    telemetryKey: "projects.dashboard",
    responseSchema: ProjectsDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ProjectsDashboard) : null),
  });
}

export async function getProjects(): Promise<LoaderResult<ProjectSummary[]>> {
  return fetchJson<unknown, ProjectSummary[]>("/api/v1/project/projects", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.list",
    responseSchema: ProjectSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as ProjectSummary[] | null,
  });
}

export async function getProjectById(id: string): Promise<LoaderResult<ProjectDetail | null>> {
  return fetchJson<unknown, ProjectDetail | null>(`/api/v1/project/projects/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "projects.detail",
    responseSchema: ProjectDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ProjectDetail) : null),
  });
}

export async function getMilestones(): Promise<LoaderResult<MilestoneSummary[]>> {
  return fetchJson<unknown, MilestoneSummary[]>("/api/v1/project/milestones", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.milestones",
    responseSchema: MilestoneSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as MilestoneSummary[] | null,
  });
}

export async function getProjectFundReleases(): Promise<LoaderResult<FundReleaseSummary[]>> {
  return fetchJson<unknown, FundReleaseSummary[]>("/api/v1/project/fund-releases", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.fund-releases",
    responseSchema: FundReleaseSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as FundReleaseSummary[] | null,
  });
}

export async function getSchemes(): Promise<LoaderResult<SchemeSummary[]>> {
  return fetchJson<unknown, SchemeSummary[]>("/api/v1/project/schemes", [], {
    revalidateSeconds: 300,
    telemetryKey: "projects.schemes",
    responseSchema: SchemeSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as SchemeSummary[] | null,
  });
}

// Grants loaders

const GRANTS_DASHBOARD_EMPTY: GrantsDashboard = {
  totalGrants: 0,
  disbursedAmount: 0,
  pendingUCs: 0,
  totalGrantees: 0,
};

export async function getGrantsDashboard(): Promise<LoaderResult<GrantsDashboard>> {
  return fetchJson<unknown, GrantsDashboard>("/api/v1/grants/dashboard", GRANTS_DASHBOARD_EMPTY, {
    revalidateSeconds: 120,
    telemetryKey: "grants.dashboard",
    responseSchema: GrantsDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as GrantsDashboard) : null),
  });
}

export async function getGrants(): Promise<LoaderResult<GrantSummary[]>> {
  return fetchJson<unknown, GrantSummary[]>("/api/v1/grants/grants", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.list",
    responseSchema: GrantSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as GrantSummary[] | null,
  });
}

export async function getGrantById(id: string): Promise<LoaderResult<GrantDetail | null>> {
  return fetchJson<unknown, GrantDetail | null>(`/api/v1/grants/grants/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "grants.detail",
    responseSchema: GrantDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as GrantDetail) : null),
  });
}

export async function getGrantees(): Promise<LoaderResult<GranteeSummary[]>> {
  return fetchJson<unknown, GranteeSummary[]>("/api/v1/grants/grantees", [], {
    revalidateSeconds: 300,
    telemetryKey: "grants.grantees",
    responseSchema: GranteeSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as GranteeSummary[] | null,
  });
}

export async function getGrantReleases(): Promise<LoaderResult<GrantRelease[]>> {
  return fetchJson<unknown, GrantRelease[]>("/api/v1/grants/releases", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.releases",
    responseSchema: GrantReleaseListSchema,
    mapResponse: (p) => getArrayPayload(p) as GrantRelease[] | null,
  });
}

/**
 * Grant disbursement detail. The grant-service exposes no GET-by-id read for a
 * disbursement; the only read surface is the tenant releases list (each row's
 * `id` is the disbursement id). We defensively resolve the disbursement from
 * that list so the detail page can show amount/status and raise the eFile.
 */
export async function getGrantDisbursementById(id: string): Promise<LoaderResult<GrantRelease | null>> {
  const { data, source } = await getGrantReleases();
  const match = data.find((row) => row.id === id) ?? null;
  return { data: match, source };
}

export async function getDisciplinaryCaseById(id: string): Promise<LoaderResult<DisciplinaryCaseDetail | null>> {
  return fetchJson<unknown, DisciplinaryCaseDetail | null>(`/api/v1/hrms/disciplinary-cases/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "hrms.disciplinary.detail",
    responseSchema: DisciplinaryCaseDetailSchema,
    mapResponse: (payload) => (isRecord(payload) ? (payload as DisciplinaryCaseDetail) : null),
  });
}

export async function getGrantInstallments(): Promise<LoaderResult<GrantInstallmentSummary[]>> {
  return fetchJson<unknown, GrantInstallmentSummary[]>("/api/v1/grants/installments", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.installments",
    responseSchema: GrantInstallmentSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as GrantInstallmentSummary[] | null,
  });
}

export async function getGrantUtilization(): Promise<LoaderResult<GrantUtilization[]>> {
  return fetchJson<unknown, GrantUtilization[]>("/api/v1/grants/utilization-certs", [], {
    revalidateSeconds: 120,
    telemetryKey: "grants.utilization",
    responseSchema: GrantUtilizationListSchema,
    mapResponse: (p) => getArrayPayload(p) as GrantUtilization[] | null,
  });
}

// Establishment loaders

const ESTAB_DASHBOARD_EMPTY: EstabDashboard = {
  filesPending: 0,
  meetingsToday: 0,
  vehiclesInUse: 0,
  complianceItemsDue: 0,
  slaBreached: 0,
  dakPending: 0,
  avgPendencyDays: 0,
};

function mapEstabDashboard(payload: unknown): EstabDashboard | null {
  if (!isRecord(payload)) return null;
  return {
    filesPending: typeof payload.filesPending === "number" ? payload.filesPending : 0,
    meetingsToday: typeof payload.meetingsToday === "number" ? payload.meetingsToday : 0,
    vehiclesInUse: typeof payload.vehiclesInUse === "number" ? payload.vehiclesInUse : 0,
    complianceItemsDue: typeof payload.complianceItemsDue === "number" ? payload.complianceItemsDue : 0,
    slaBreached: typeof payload.slaBreached === "number" ? payload.slaBreached : 0,
    dakPending: typeof payload.dakPending === "number" ? payload.dakPending : 0,
    avgPendencyDays: typeof payload.avgPendencyDays === "number" ? payload.avgPendencyDays : 0,
  };
}

export async function getEstabDashboard(): Promise<LoaderResult<EstabDashboard>> {
  return fetchJson<unknown, EstabDashboard>("/api/v1/estab/dashboard", ESTAB_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "estab.dashboard",
    responseSchema: EstabDashboardSchema,
    mapResponse: mapEstabDashboard,
  });
}

export async function getEstabFiles(): Promise<LoaderResult<EstabFileSummary[]>> {
  return fetchJson<unknown, EstabFileSummary[]>("/api/v1/estab/files", [], {
    revalidateSeconds: 60,
    telemetryKey: "estab.files",
    mapResponse: mapEstabFileSummaries,
  });
}

export async function getEstabFileById(id: string): Promise<LoaderResult<EstabFileDetail | null>> {
  return fetchJson<unknown, EstabFileDetail | null>(`/api/v1/estab/files/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "estab.file.detail",
    responseSchema: EstabFileDetailSchema,
    mapResponse: (p) => mapEstabFileDetail(p),
  });
}

export async function getMeetings(): Promise<LoaderResult<MeetingSummary[]>> {
  return fetchJson<unknown, MeetingSummary[]>("/api/v1/estab/meetings", [], {
    revalidateSeconds: 60,
    telemetryKey: "estab.meetings",
    responseSchema: MeetingSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as MeetingSummary[] | null,
  });
}

export async function getMeetingById(id: string): Promise<LoaderResult<MeetingDetail | null>> {
  return fetchJson<unknown, MeetingDetail | null>(`/api/v1/estab/meetings/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "estab.meeting.detail",
    responseSchema: MeetingDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as MeetingDetail) : null),
  });
}

export async function getVehicles(): Promise<LoaderResult<VehicleSummary[]>> {
  return fetchJson<unknown, VehicleSummary[]>("/api/v1/estab/vehicles", [], {
    revalidateSeconds: 120,
    telemetryKey: "estab.vehicles",
    responseSchema: VehicleSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as VehicleSummary[] | null,
  });
}

export async function getGuesthouseBookings(): Promise<LoaderResult<GuesthouseBookingSummary[]>> {
  return fetchJson<unknown, GuesthouseBookingSummary[]>("/api/v1/estab/guesthouse-bookings", [], {
    revalidateSeconds: 60,
    telemetryKey: "estab.guesthouse",
    responseSchema: GuesthouseBookingSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as GuesthouseBookingSummary[] | null,
  });
}

export async function getEstabCompliance(): Promise<LoaderResult<ComplianceSummary[]>> {
  return fetchJson<unknown, ComplianceSummary[]>("/api/v1/estab/compliance", [], {
    revalidateSeconds: 120,
    telemetryKey: "estab.compliance",
    responseSchema: ComplianceSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as ComplianceSummary[] | null,
  });
}

export async function getLibraryBooks(query?: { search?: string; status?: "available" | "unavailable" }): Promise<LoaderResult<LibraryBookSummary[]>> {
  const params = new URLSearchParams();
  if (query?.search) params.set("search", query.search);
  if (query?.status) params.set("status", query.status);
  return fetchJson<unknown, LibraryBookSummary[]>(`/api/v1/estab/library/books?${params.toString()}`, [], {
    revalidateSeconds: 30,
    telemetryKey: "estab.library.books",
    responseSchema: LibraryBookSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as LibraryBookSummary[] | null,
  });
}

export async function getLibraryBookById(id: string): Promise<LoaderResult<LibraryBookSummary | null>> {
  return fetchJson<unknown, LibraryBookSummary | null>(`/api/v1/estab/library/books/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "estab.library.book.detail",
    responseSchema: LibraryBookSummarySchema,
    mapResponse: (p) => (p && typeof p === "object" ? (p as LibraryBookSummary) : null),
  });
}

export async function getLibraryIssues(status?: "issued" | "returned" | "overdue"): Promise<LoaderResult<LibraryIssueSummary[]>> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  return fetchJson<unknown, LibraryIssueSummary[]>(`/api/v1/estab/library/issues?${params.toString()}`, [], {
    revalidateSeconds: 30,
    telemetryKey: "estab.library.issues",
    responseSchema: LibraryIssueSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as LibraryIssueSummary[] | null,
  });
}

// Asset loaders

const ASSET_DASHBOARD_EMPTY: AssetDashboard = {
  totalAssets: 0,
  fixedAssets: 0,
  infraAssets: 0,
  underMaintenance: 0,
  dueForDisposal: 0,
  taggedAssets: 0,
  netBlock: 0,
  recentGrnAssets: [],
};

function mapAssetDashboard(payload: unknown): AssetDashboard | null {
  if (!isRecord(payload)) return null;
  const recentRaw = Array.isArray(payload.recentGrnAssets) ? payload.recentGrnAssets : [];
  return {
    totalAssets: typeof payload.totalAssets === "number" ? payload.totalAssets : 0,
    fixedAssets: typeof payload.fixedAssets === "number" ? payload.fixedAssets : 0,
    infraAssets: typeof payload.infraAssets === "number" ? payload.infraAssets : 0,
    underMaintenance: typeof payload.underMaintenance === "number" ? payload.underMaintenance : 0,
    dueForDisposal: typeof payload.dueForDisposal === "number" ? payload.dueForDisposal : 0,
    taggedAssets: typeof payload.taggedAssets === "number" ? payload.taggedAssets : 0,
    netBlock: typeof payload.netBlock === "number" ? payload.netBlock : 0,
    recentGrnAssets: recentRaw.flatMap((r) => {
      if (!isRecord(r)) return [];
      const id = toText(r.id);
      if (!id) return [];
      return [{
        id,
        code: toText(r.code) ?? id,
        name: toText(r.name) ?? "Asset",
        acquisitionDate: toText(r.acquisitionDate) ?? "",
        acquisitionCost: typeof r.acquisitionCost === "number" ? r.acquisitionCost : 0,
      }];
    }),
  };
}

export async function getAssetDashboard(): Promise<LoaderResult<AssetDashboard>> {
  return fetchJson<unknown, AssetDashboard>("/api/v1/asset/dashboard", ASSET_DASHBOARD_EMPTY, {
    revalidateSeconds: 120,
    telemetryKey: "assets.dashboard",
    responseSchema: AssetDashboardSchema,
    mapResponse: mapAssetDashboard,
  });
}

export async function getAssets(): Promise<LoaderResult<AssetSummary[]>> {
  return fetchJson<unknown, AssetSummary[]>("/api/v1/asset/assets", [], {
    revalidateSeconds: 120,
    telemetryKey: "assets.list",
    mapResponse: mapAssetSummaries,
  });
}

export async function getAssetById(id: string): Promise<LoaderResult<AssetDetail | null>> {
  const base = await fetchJson<unknown, AssetDetail | null>(`/api/v1/asset/assets/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "assets.detail",
    mapResponse: mapAssetDetail,
  });
  if (!base.data) return base;

  const [dep, maint] = await Promise.all([
    fetchJson<unknown, AssetDetail["depreciationSchedule"]>(`/api/v1/asset/assets/${id}/depreciation`, [], {
      revalidateSeconds: 60,
      telemetryKey: "assets.depreciation",
      mapResponse: mapDepreciationEntries,
    }),
    fetchJson<unknown, AssetDetail["maintenanceHistory"]>(`/api/v1/asset/assets/${id}/maintenance`, [], {
      revalidateSeconds: 60,
      telemetryKey: "assets.maintenance.history",
      mapResponse: mapAssetMaintenanceHistory,
    }),
  ]);

  return {
    ...base,
    data: {
      ...base.data,
      depreciationSchedule: dep.data ?? [],
      maintenanceHistory: maint.data ?? [],
    },
  };
}

export async function getFixedAssets(): Promise<LoaderResult<AssetSummary[]>> {
  return fetchJson<unknown, AssetSummary[]>("/api/v1/asset/assets?type=fixed", [], {
    revalidateSeconds: 120,
    telemetryKey: "assets.fixed",
    mapResponse: mapAssetSummaries,
  });
}

export async function getInfraAssets(): Promise<LoaderResult<AssetSummary[]>> {
  return fetchJson<unknown, AssetSummary[]>("/api/v1/asset/assets?type=infra", [], {
    revalidateSeconds: 120,
    telemetryKey: "assets.infra",
    mapResponse: mapAssetSummaries,
  });
}

export async function getAssetMaintenance(): Promise<LoaderResult<MaintenanceSummary[]>> {
  return fetchJson<unknown, MaintenanceSummary[]>("/api/v1/asset/maintenance", [], {
    revalidateSeconds: 120,
    telemetryKey: "assets.maintenance",
    mapResponse: mapMaintenanceSummaries,
  });
}

// Stock loaders

const STOCK_DASHBOARD_EMPTY: StockDashboard = {
  totalSKUs: 0,
  lowStockAlerts: 0,
  grnsThisMonth: 0,
  inventoryValue: 0,
};

function mapStockDashboard(payload: unknown): StockDashboard | null {
  if (!isRecord(payload)) return null;
  return {
    totalSKUs: typeof payload.totalSKUs === "number" ? payload.totalSKUs : 0,
    lowStockAlerts: typeof payload.lowStockAlerts === "number" ? payload.lowStockAlerts : 0,
    grnsThisMonth: typeof payload.grnsThisMonth === "number" ? payload.grnsThisMonth : 0,
    inventoryValue: typeof payload.inventoryValue === "number" ? payload.inventoryValue : 0,
  };
}

export async function getStockDashboard(): Promise<LoaderResult<StockDashboard>> {
  return fetchJson<unknown, StockDashboard>("/api/v1/stock/dashboard", STOCK_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "stock.dashboard",
    responseSchema: StockDashboardSchema,
    mapResponse: mapStockDashboard,
  });
}

export async function getStockItems(): Promise<LoaderResult<StockItemSummary[]>> {
  return fetchJson<unknown, StockItemSummary[]>("/api/v1/stock/items", [], {
    revalidateSeconds: 60,
    telemetryKey: "stock.items",
    mapResponse: mapStockItemSummaries,
  });
}

export async function getStockItemById(id: string): Promise<LoaderResult<StockItemDetail | null>> {
  return fetchJson<unknown, StockItemDetail | null>(`/api/v1/stock/items/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "stock.item.detail",
    mapResponse: mapStockItemDetail,
  });
}

export async function getStockLedger(): Promise<LoaderResult<StockLedgerEntry[]>> {
  return fetchJson<unknown, StockLedgerEntry[]>("/api/v1/stock/ledger", [], {
    revalidateSeconds: 60,
    telemetryKey: "stock.ledger",
    mapResponse: mapStockLedgerEntries,
  });
}

// ── Audit loaders ─────────────────────────────────────────────────────────────

const AUDIT_DASHBOARD_EMPTY: AuditDashboard = {
  openObservations: 0,
  riskRegisterItems: 0,
  cagParas: 0,
  compliancePct: 0,
};

export async function getAuditDashboard(): Promise<LoaderResult<AuditDashboard>> {
  return fetchJson<unknown, AuditDashboard>("/api/v1/audit/dashboard", AUDIT_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "audit.dashboard",
    responseSchema: AuditDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as AuditDashboard) : null),
  });
}

export async function getAuditObservations(): Promise<LoaderResult<AuditObservationSummary[]>> {
  return fetchJson<unknown, AuditObservationSummary[]>("/api/v1/audit/observations", [], {
    revalidateSeconds: 60,
    telemetryKey: "audit.observations",
    responseSchema: AuditObservationSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AuditObservationSummary[] | null,
  });
}

export async function getAuditObservationById(id: string): Promise<LoaderResult<AuditObservationDetail | null>> {
  return fetchJson<unknown, AuditObservationDetail | null>(`/api/v1/audit/observations/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "audit.observation.detail",
    responseSchema: AuditObservationDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as AuditObservationDetail) : null),
  });
}

export async function getRiskRegister(): Promise<LoaderResult<RiskSummary[]>> {
  return fetchJson<unknown, RiskSummary[]>("/api/v1/audit/risks", [], {
    revalidateSeconds: 120,
    telemetryKey: "audit.risks",
    responseSchema: RiskSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as RiskSummary[] | null,
  });
}

export async function getAuditPlan(): Promise<LoaderResult<AuditPlanItem[]>> {
  return fetchJson<unknown, AuditPlanItem[]>("/api/v1/audit/plan", [], {
    revalidateSeconds: 300,
    telemetryKey: "audit.plan",
    responseSchema: AuditPlanListSchema,
    mapResponse: (p) => getArrayPayload(p) as AuditPlanItem[] | null,
  });
}

export async function getAuditCompliance(): Promise<LoaderResult<AuditComplianceItem[]>> {
  return fetchJson<unknown, AuditComplianceItem[]>("/api/v1/audit/compliance", [], {
    revalidateSeconds: 120,
    telemetryKey: "audit.compliance",
    responseSchema: AuditComplianceListSchema,
    mapResponse: (p) => getArrayPayload(p) as AuditComplianceItem[] | null,
  });
}

export async function getAuditExports(): Promise<LoaderResult<AuditExportJob[]>> {
  return fetchJson<unknown, AuditExportJob[]>("/api/v1/audit/exports", [], {
    revalidateSeconds: 30,
    telemetryKey: "audit.exports",
    responseSchema: AuditExportJobListSchema,
    mapResponse: (p) => getArrayPayload(p) as AuditExportJob[] | null,
  });
}

export type { CagParaSummary, VigilanceCaseSummary, InvestigationSummary } from "@civitasone/types";

export async function getCagParas(): Promise<LoaderResult<CagParaSummary[]>> {
  return fetchJson<unknown, CagParaSummary[]>("/api/v1/audit/paras", [], {
    revalidateSeconds: 60,
    telemetryKey: "audit.cag-paras",
    responseSchema: CagParaSummaryListSchema,
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const mapped: CagParaSummary[] = [];
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const id = toText(row.id);
        const paraNo = toText(row.paraNo) ?? "";
        const reportYear = toText(row.reportYear) ?? toText(row.sourceRef) ?? "";
        const department = toText(row.department) ?? toText(row.deptRef) ?? "";
        const status = row.status === "settled" ? "settled" :
                       row.status === "closed" ? "settled" :
                       row.status === "replied" ? "partially_settled" :
                       row.status === "pending_recovery" ? "nearly_settled" :
                       "under_review";
        if (!id) continue;
        mapped.push({
          id,
          reportYear,
          paraNo,
          department,
          totalParas: 1,
          settled: status === "settled" ? 1 : 0,
          pending: status === "settled" ? 0 : 1,
          status,
        });
      }
      return mapped.length > 0 ? mapped : null;
    },
  });
}

export async function getVigilanceCases(): Promise<LoaderResult<VigilanceCaseSummary[]>> {
  return fetchJson<unknown, VigilanceCaseSummary[]>("/api/v1/audit/vigilance", [], {
    revalidateSeconds: 60,
    telemetryKey: "audit.vigilance",
    responseSchema: VigilanceCaseSummaryListSchema,
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const mapped: VigilanceCaseSummary[] = [];
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const id = toText(row.id);
        const caseNo = toText(row.caseNo) ?? "";
        const officer = toText(row.officer) ?? "";
        const charges = toText(row.charges) ?? "";
        const rawInquiry = toText(row.inquiryStatus) ?? "preliminary_enquiry";
        const inquiryStatus = (rawInquiry === "preliminary_enquiry" || rawInquiry === "under_investigation" || rawInquiry === "charge_sheet_issued" || rawInquiry === "inquiry_complete")
          ? rawInquiry : "preliminary_enquiry";
        const rawOutcome = toText(row.outcome) ?? "pending";
        const outcome = (rawOutcome === "pending" || rawOutcome === "major_penalty" || rawOutcome === "minor_penalty" || rawOutcome === "exonerated")
          ? rawOutcome : "pending";
        if (!id) continue;
        mapped.push({ id, caseNo, officer, charges, inquiryStatus, outcome });
      }
      return mapped.length > 0 ? mapped : null;
    },
  });
}

export async function getInvestigations(): Promise<LoaderResult<InvestigationSummary[]>> {
  return fetchJson<unknown, InvestigationSummary[]>("/api/v1/audit/investigations", [], {
    revalidateSeconds: 60,
    telemetryKey: "audit.investigations",
    responseSchema: InvestigationSummaryListSchema,
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const mapped: InvestigationSummary[] = [];
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const id = toText(row.id);
        const caseId = toText(row.caseId) ?? "";
        const subject = toText(row.subject) ?? "";
        const assignedTo = toText(row.assignedTo) ?? "";
        const started = toText(row.started) ?? "";
        const findings = toText(row.findings) ?? "";
        const rawStatus = toText(row.status) ?? "in_progress";
        const status = (rawStatus === "in_progress" || rawStatus === "findings_submitted" || rawStatus === "closed")
          ? rawStatus : "in_progress";
        if (!id) continue;
        mapped.push({ id, caseId, subject, assignedTo, started, findings, status });
      }
      return mapped.length > 0 ? mapped : null;
    },
  });
}

// ── Legal loaders ─────────────────────────────────────────────────────────────

const LEGAL_DASHBOARD_EMPTY: LegalDashboard = {
  activeCases: 0,
  hearingsThisWeek: 0,
  ordersPending: 0,
  opinionsDue: 0,
};

export async function getLegalDashboard(): Promise<LoaderResult<LegalDashboard>> {
  return fetchJson<unknown, LegalDashboard>("/api/v1/legal/dashboard", LEGAL_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "legal.dashboard",
    responseSchema: LegalDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as LegalDashboard) : null),
  });
}

export async function getLegalCases(): Promise<LoaderResult<LegalCaseSummary[]>> {
  return fetchJson<unknown, LegalCaseSummary[]>("/api/v1/legal/cases", [], {
    revalidateSeconds: 60,
    telemetryKey: "legal.cases",
    mapResponse: mapLegalCaseSummaries,
  });
}

export async function getLegalCaseById(id: string): Promise<LoaderResult<LegalCaseDetail | null>> {
  return fetchJson<unknown, LegalCaseDetail | null>(`/api/v1/legal/cases/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "legal.case.detail",
    responseSchema: LegalCaseDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as LegalCaseDetail) : null),
  });
}

export async function getLegalHearings(): Promise<LoaderResult<HearingSummary[]>> {
  return fetchJson<unknown, HearingSummary[]>("/api/v1/legal/hearings", [], {
    revalidateSeconds: 60,
    telemetryKey: "legal.hearings",
    responseSchema: HearingSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as HearingSummary[] | null,
  });
}

export async function getCourtOrders(): Promise<LoaderResult<CourtOrderSummary[]>> {
  return fetchJson<unknown, CourtOrderSummary[]>("/api/v1/legal/court-orders", [], {
    revalidateSeconds: 60,
    telemetryKey: "legal.court-orders",
    responseSchema: CourtOrderSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as CourtOrderSummary[] | null,
  });
}

export async function getLegalOpinions(): Promise<LoaderResult<LegalOpinionSummary[]>> {
  return fetchJson<unknown, LegalOpinionSummary[]>("/api/v1/legal/opinions", [], {
    revalidateSeconds: 120,
    telemetryKey: "legal.opinions",
    responseSchema: LegalOpinionSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as LegalOpinionSummary[] | null,
  });
}

export async function getLegalOpinionById(id: string): Promise<LoaderResult<Record<string, unknown> | null>> {
  return fetchJson<unknown, Record<string, unknown> | null>(`/api/v1/legal/opinions/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "legal.opinion.detail",
    mapResponse: (payload) => (isRecord(payload) ? (payload as Record<string, unknown>) : null),
  });
}

// ── Admin / Platform loaders ──────────────────────────────────────────────────

export async function getAdminUsers(): Promise<LoaderResult<UserSummary[]>> {
  return fetchJson<unknown, UserSummary[]>("/api/identity/users", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.users",
    mapResponse: mapAdminUserSummaries,
  });
}

export async function getAdminUserById(id: string): Promise<LoaderResult<UserDetail | null>> {
  return fetchJson<unknown, UserDetail | null>(`/api/identity/users/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "admin.user.detail",
    responseSchema: UserDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as UserDetail) : null),
  });
}

export async function getAdminRoles(): Promise<LoaderResult<RoleDetail[]>> {
  return fetchJson<unknown, RoleDetail[]>("/api/policy/roles", [], {
    revalidateSeconds: 120,
    telemetryKey: "admin.roles",
    responseSchema: AdminRoleSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as RoleDetail[] | null,
  });
}

export async function getAdminRoleById(id: string): Promise<LoaderResult<RoleDetail | null>> {
  return fetchJson<unknown, RoleDetail | null>(`/api/policy/roles/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "admin.role.detail",
    responseSchema: RoleDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as RoleDetail) : null),
  });
}

export async function getTenantModules(): Promise<LoaderResult<TenantModule[]>> {
  return fetchJson<unknown, TenantModule[]>("/api/v1/admin/tenant/modules", [], {
    revalidateSeconds: 300,
    telemetryKey: "admin.modules",
    responseSchema: TenantModuleListSchema,
    mapResponse: (p) => getArrayPayload(p) as TenantModule[] | null,
  });
}

// ─── SA Admin: Platform Management Loaders ───────────────────────────────────

export async function getSATenants(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/tenants", [], {
    revalidateSeconds: 60, telemetryKey: "sa.tenants",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAMetering(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/billing/metering", [], {
    revalidateSeconds: 60, telemetryKey: "sa.metering",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAFeatureFlags(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/feature-flags", [], {
    revalidateSeconds: 30, telemetryKey: "sa.feature-flags",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAGateways(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/gateways", [], {
    revalidateSeconds: 60, telemetryKey: "sa.gateways",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAEditions(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/editions", [], {
    revalidateSeconds: 300, telemetryKey: "sa.editions",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAOperators(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/operators", [], {
    revalidateSeconds: 60, telemetryKey: "sa.operators",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAOnboarding(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/onboarding", [], {
    revalidateSeconds: 30, telemetryKey: "sa.onboarding",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAInvoices(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/billing/invoices", [], {
    revalidateSeconds: 120, telemetryKey: "sa.invoices",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAEntitlements(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/entitlements", [], {
    revalidateSeconds: 300, telemetryKey: "sa.entitlements",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSAApiMonitoring(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/api-monitoring", [], {
    revalidateSeconds: 30, telemetryKey: "sa.api-monitoring",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSATechAdmin(): Promise<LoaderResult<Record<string, unknown>[]>> {
  return fetchJson<unknown, Record<string, unknown>[]>("/api/v1/admin/health/services", [], {
    revalidateSeconds: 30, telemetryKey: "sa.tech-admin",
    mapResponse: (p) => getArrayPayload(p) as Record<string, unknown>[] | null,
  });
}

export async function getSADashboard(): Promise<LoaderResult<Record<string, unknown>>> {
  return fetchJson<unknown, Record<string, unknown>>("/api/v1/admin/sa-dashboard", {}, {
    revalidateSeconds: 30, telemetryKey: "sa.dashboard",
    mapResponse: (p) => (isRecord(p) ? p as Record<string, unknown> : null),
  });
}

export async function getActiveSessions(): Promise<LoaderResult<SessionSummary[]>> {
  return fetchJson<unknown, SessionSummary[]>("/api/identity/sessions", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.sessions",
    responseSchema: SessionSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as SessionSummary[] | null,
  });
}

export async function getSubscription(): Promise<LoaderResult<SubscriptionSummary | null>> {
  return fetchJson<unknown, SubscriptionSummary | null>("/api/v1/billing/subscriptions", null, {
    revalidateSeconds: 300,
    telemetryKey: "admin.subscription",
    responseSchema: SubscriptionSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as SubscriptionSummary) : null),
  });
}

export async function getAPIKeys(): Promise<LoaderResult<APIKeySummary[]>> {
  return fetchJson<unknown, APIKeySummary[]>("/api/v1/admin/api-keys", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.api-keys",
    responseSchema: APIKeySummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as APIKeySummary[] | null,
  });
}

export async function getBreakglassLog(): Promise<LoaderResult<BreakglassSummary[]>> {
  return fetchJson<unknown, BreakglassSummary[]>("/api/v1/admin/breakglass", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.breakglass",
    responseSchema: BreakglassSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as BreakglassSummary[] | null,
  });
}

export async function getNotificationPreferences(): Promise<LoaderResult<NotificationPrefSummary[]>> {
  return fetchJson<unknown, NotificationPrefSummary[]>("/api/notification/preferences", [], {
    revalidateSeconds: 120,
    telemetryKey: "admin.notifications",
    responseSchema: NotificationPrefSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as NotificationPrefSummary[] | null,
  });
}

export async function getInstallSteps(): Promise<LoaderResult<InstallStepSummary[]>> {
  return fetchJson<unknown, InstallStepSummary[]>("/api/v1/install/steps", [], {
    revalidateSeconds: 60,
    telemetryKey: "install.steps",
    responseSchema: InstallStepSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as InstallStepSummary[] | null,
  });
}

export async function getTenantAuditLog(): Promise<LoaderResult<TenantAuditEvent[]>> {
  return fetchJson<unknown, TenantAuditEvent[]>("/api/v1/audit/events?tenantScoped=true", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.audit",
    responseSchema: TenantAuditEventListSchema,
    mapResponse: (p) => getArrayPayload(p) as TenantAuditEvent[] | null,
  });
}

// ── Reports / Analytics loaders ───────────────────────────────────────────────

const REPORTS_DASHBOARD_EMPTY: ReportDashboard = { kpis: [] };

export async function getReportsDashboard(): Promise<LoaderResult<ReportDashboard>> {
  return fetchJson<unknown, ReportDashboard>("/api/v1/reports/dashboards", REPORTS_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "reports.dashboard",
    responseSchema: ReportDashboardSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ReportDashboard) : null),
  });
}

export async function getReportJobs(): Promise<LoaderResult<ReportJobSummary[]>> {
  return fetchJson<unknown, ReportJobSummary[]>("/api/v1/reports/report-jobs", [], {
    revalidateSeconds: 60,
    telemetryKey: "reports.jobs",
    responseSchema: ReportJobSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as ReportJobSummary[] | null,
  });
}

export async function getReportJobById(id: string): Promise<LoaderResult<ReportJobDetail | null>> {
  return fetchJson<unknown, ReportJobDetail | null>(`/api/v1/reports/report-jobs/${id}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "reports.job.detail",
    responseSchema: ReportJobDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as ReportJobDetail) : null),
  });
}

export async function getKPIs(): Promise<LoaderResult<KPISummary[]>> {
  return fetchJson<unknown, KPISummary[]>("/api/v1/reports/kpis", [], {
    revalidateSeconds: 120,
    telemetryKey: "reports.kpis",
    responseSchema: KPISummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as KPISummary[] | null,
  });
}

export async function getMISSummary(): Promise<LoaderResult<MISSummary[]>> {
  return fetchJson<unknown, MISSummary[]>("/api/v1/reports/mis", [], {
    revalidateSeconds: 120,
    telemetryKey: "reports.mis",
    responseSchema: MISSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as MISSummary[] | null,
  });
}

// ── Knowledge / DMS loaders ───────────────────────────────────────────────────

export async function getKnowledgeDocs(): Promise<LoaderResult<KnowledgeDocSummary[]>> {
  return fetchJson<unknown, KnowledgeDocSummary[]>("/api/v1/knowledge/documents", [], {
    revalidateSeconds: 120,
    telemetryKey: "knowledge.docs",
    responseSchema: KnowledgeDocSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as KnowledgeDocSummary[] | null,
  });
}

export async function getKnowledgeRecords(): Promise<LoaderResult<KnowledgeRecord[]>> {
  return fetchJson<unknown, KnowledgeRecord[]>("/api/v1/knowledge/records", [], {
    revalidateSeconds: 120,
    telemetryKey: "knowledge.records",
    responseSchema: KnowledgeRecordListSchema,
    mapResponse: (p) => getArrayPayload(p) as KnowledgeRecord[] | null,
  });
}

// ── Notification loaders (enhanced typed versions) ────────────────────────────

export async function getNotifications(): Promise<LoaderResult<NotificationItem[]>> {
  return fetchJson<unknown, NotificationItem[]>("/api/notification/notifications", [], {
    revalidateSeconds: 30,
    telemetryKey: "notifications.list",
    responseSchema: NotificationItemListSchema,
    mapResponse: (p) => getArrayPayload(p) as NotificationItem[] | null,
  });
}

export async function getNotificationDeliveries(): Promise<LoaderResult<NotificationDelivery[]>> {
  return fetchJson<unknown, NotificationDelivery[]>("/api/notification/deliveries", [], {
    revalidateSeconds: 30,
    telemetryKey: "notifications.deliveries",
    responseSchema: NotificationDeliveryListSchema,
    mapResponse: (p) => getArrayPayload(p) as NotificationDelivery[] | null,
  });
}

export type StatutoryRow = { id: string; employeeId: string; period: string; empContribMinor?: number; erContribMinor?: number; basicMinor?: number };

export async function getGpfStatements(): Promise<LoaderResult<StatutoryRow[]>> {
  return fetchJson<unknown, StatutoryRow[]>("/api/v1/payroll/statutory/gpf", [], {
    revalidateSeconds: 120,
    telemetryKey: "payroll.gpf",
    mapResponse: (p) => (Array.isArray(p) ? p : (p as { data?: StatutoryRow[] })?.data ?? []) as StatutoryRow[],
  });
}

export async function getNpsStatements(): Promise<LoaderResult<StatutoryRow[]>> {
  return fetchJson<unknown, StatutoryRow[]>("/api/v1/payroll/statutory/nps", [], {
    revalidateSeconds: 120,
    telemetryKey: "payroll.nps",
    mapResponse: (p) => (Array.isArray(p) ? p : (p as { data?: StatutoryRow[] })?.data ?? []) as StatutoryRow[],
  });
}

export type PayMatrixLevel = { level: number; payGrade: string; cells: Array<{ cell: number; basicDisplay: string }> };

export async function getPayMatrix(): Promise<LoaderResult<PayMatrixLevel[]>> {
  return fetchJson<unknown, PayMatrixLevel[]>("/api/v1/hrms/pay-matrix", [], {
    revalidateSeconds: 300,
    telemetryKey: "hrms.payMatrix",
    mapResponse: (p) => (p as { data?: PayMatrixLevel[] })?.data ?? [],
  });
}

export async function getSlipById(id: string): Promise<LoaderResult<SalarySlipSummary | null>> {
  return fetchJson<unknown, SalarySlipSummary | null>(`/api/v1/payroll/slips/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "hr.salary-slip.detail",
    mapResponse: (p) => (isRecord(p) ? (p as SalarySlipSummary) : null),
  });
}

export async function getTaxDeclaration(employeeId: string): Promise<LoaderResult<TaxDeclaration | null>> {
  return fetchJson<unknown, TaxDeclaration | null>(
    `/api/v1/payroll/tax-declarations?employeeId=${encodeURIComponent(employeeId)}`,
    null,
    {
      revalidateSeconds: 300,
      telemetryKey: "hr.tax-declaration",
      mapResponse: (p) => (isRecord(p) ? (p as TaxDeclaration) : null),
    },
  );
}

export async function getAttendanceListByMonth(month?: string): Promise<LoaderResult<AttendanceSummaryItem[]>> {
  const path = month
    ? `/api/v1/hrms/attendance?month=${encodeURIComponent(month)}`
    : "/api/v1/hrms/attendance";
  return fetchJson<unknown, AttendanceSummaryItem[]>(path, [], {
    revalidateSeconds: 60,
    telemetryKey: "hr.attendance.list.filtered",
    responseSchema: AttendanceSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as AttendanceSummaryItem[] | null,
  });
}

// ── Pensioner loaders ─────────────────────────────────────────────────────────

export async function getPensioners(): Promise<LoaderResult<PensionerSummary[]>> {
  return fetchJson<unknown, PensionerSummary[]>("/api/v1/payroll/pensioners", [], {
    revalidateSeconds: 120,
    telemetryKey: "payroll.pensioners",
    mapResponse: (p) => getArrayPayload(p) as PensionerSummary[] | null,
  });
}

// ── Tenant Admin: Mock Page Elimination loaders ───────────────────────────────

export type SsoProvider = {
  id: string;
  name: string;
  protocol: string;
  entityId: string;
  status: string;
  lastSync: string;
};

export async function getSsoProviders(): Promise<LoaderResult<SsoProvider[]>> {
  return fetchJson<unknown, SsoProvider[]>("/api/v1/admin/sso/providers", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.sso.providers",
    mapResponse: (p) => getArrayPayload(p) as SsoProvider[] | null,
  });
}

export type UsageResource = {
  resource: string;
  label: string;
  icon: string;
  limit: number;
  used: number;
  unit: string;
  projectedOverageDate: string | null;
};

export async function getUsageQuotas(): Promise<LoaderResult<UsageResource[]>> {
  return fetchJson<unknown, UsageResource[]>("/api/v1/admin/usage", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.usage",
    mapResponse: (p) => getArrayPayload(p) as UsageResource[] | null,
  });
}

export type SiemAlert = {
  id: string;
  timestamp: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  source: string;
  status: string;
};

export async function getSiemAlerts(): Promise<LoaderResult<SiemAlert[]>> {
  return fetchJson<unknown, SiemAlert[]>("/api/v1/admin/siem/alerts", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.siem.alerts",
    mapResponse: (p) => getArrayPayload(p) as SiemAlert[] | null,
  });
}

export type PlanSummary = {
  id: string;
  name: string;
  pricePerMonth: number;
  maxUsers: number;
  storageGb: number;
  maxApiCalls: number;
  modules: string[];
};

export type InvoiceSummary = {
  id: string;
  date: string;
  amount: number;
  status: "paid" | "pending" | "failed";
};

export type PlansData = {
  plans: PlanSummary[];
  currentPlanId: string;
  invoices: InvoiceSummary[];
  trialDaysLeft: number | null;
};

export async function getPlansData(): Promise<LoaderResult<PlansData>> {
  return fetchJson<unknown, PlansData>(
    "/api/v1/billing/plans",
    { plans: [], currentPlanId: "", invoices: [], trialDaysLeft: null },
    {
      revalidateSeconds: 300,
      telemetryKey: "admin.plans",
      mapResponse: (p) => (isRecord(p) ? (p as PlansData) : null),
    },
  );
}

export type SecurityEvent = {
  id: string;
  timestamp: string;
  type: string;
  actor: string;
  ipAddress: string;
  outcome: string;
};

export type SecurityOverview = {
  activeSessions: number;
  failedLogins24h: number;
  mfaAdoptionRate: number;
  trustedDevices: number;
  events: SecurityEvent[];
};

export async function getSecurityOverview(): Promise<LoaderResult<SecurityOverview>> {
  return fetchJson<unknown, SecurityOverview>(
    "/api/v1/admin/security/overview",
    { activeSessions: 0, failedLogins24h: 0, mfaAdoptionRate: 0, trustedDevices: 0, events: [] },
    {
      revalidateSeconds: 30,
      telemetryKey: "admin.security.overview",
      mapResponse: (p) => (isRecord(p) ? (p as SecurityOverview) : null),
    },
  );
}

export type DataExportRequest = {
  id: string;
  type: "full" | "module" | "entity";
  moduleFilter: string | null;
  format: "csv" | "json" | "pdf";
  status: "pending" | "processing" | "ready" | "expired" | "failed";
  fileSizeBytes: number | null;
  createdAt: string;
  expiresAt: string | null;
};

export async function getDataExports(): Promise<LoaderResult<DataExportRequest[]>> {
  return fetchJson<unknown, DataExportRequest[]>("/api/v1/admin/data-exports", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.data-exports",
    mapResponse: (p) => getArrayPayload(p) as DataExportRequest[] | null,
  });
}

export type OrgHierarchyNode = {
  id: string;
  name: string;
  headCount: number;
  children?: OrgHierarchyNode[];
};

export async function getOrgHierarchy(): Promise<LoaderResult<OrgHierarchyNode[]>> {
  return fetchJson<unknown, OrgHierarchyNode[]>("/api/v1/admin/org-hierarchy", [], {
    revalidateSeconds: 300,
    telemetryKey: "admin.org-hierarchy",
    mapResponse: (p) => getArrayPayload(p) as OrgHierarchyNode[] | null,
  });
}

export type MfaUserStatus = {
  id: string;
  name: string;
  email: string;
  department: string;
  mfaStatus: string;
  enrolledAt: string | null;
};

export async function getMfaUsers(): Promise<LoaderResult<MfaUserStatus[]>> {
  return fetchJson<unknown, MfaUserStatus[]>("/api/v1/admin/mfa/users", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.mfa.users",
    mapResponse: (p) => getArrayPayload(p) as MfaUserStatus[] | null,
  });
}

export type IdpProviderSummary = {
  id: string;
  name: string;
  protocol: string;
  status: string;
  usersSynced: number;
  lastSync: string;
  endpoint: string;
};

export async function getIdpProviders(): Promise<LoaderResult<IdpProviderSummary[]>> {
  return fetchJson<unknown, IdpProviderSummary[]>("/api/v1/admin/idp/providers", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.idp.providers",
    mapResponse: (p) => getArrayPayload(p) as IdpProviderSummary[] | null,
  });
}

export type CustomDomain = {
  id: string;
  domain: string;
  status: "pending_verification" | "verified" | "active" | "failed" | "revoked";
  verificationMethod: "dns_txt" | "dns_cname";
  verificationToken: string;
  sslStatus: "pending" | "issued" | "expired";
  sslExpiresAt: string | null;
  createdAt: string;
};

export async function getCustomDomains(): Promise<LoaderResult<CustomDomain[]>> {
  return fetchJson<unknown, CustomDomain[]>("/api/v1/admin/custom-domains", [], {
    revalidateSeconds: 120,
    telemetryKey: "admin.domains",
    mapResponse: (p) => getArrayPayload(p) as CustomDomain[] | null,
  });
}

export type ComplianceCheck = {
  id: string;
  timestamp: string;
  title: string;
  result: "pass" | "warn" | "fail";
};

export type ComplianceOverview = {
  dpdpScore: number;
  certInReadiness: number;
  retentionStatus: string;
  checks: ComplianceCheck[];
};

export async function getComplianceOverview(): Promise<LoaderResult<ComplianceOverview>> {
  return fetchJson<unknown, ComplianceOverview>(
    "/api/v1/admin/compliance",
    { dpdpScore: 0, certInReadiness: 0, retentionStatus: "Unknown", checks: [] },
    {
      revalidateSeconds: 120,
      telemetryKey: "admin.compliance",
      mapResponse: (p) => (isRecord(p) ? (p as ComplianceOverview) : null),
    },
  );
}

export type WebhookSummary = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string;
  lastDeliveryStatus: number | null;
  createdAt: string;
};

export type WebhookDelivery = {
  id: string;
  eventType: string;
  statusCode: number;
  attempt: number;
  deliveredAt: string;
  responseBody: string;
};

export async function getWebhooks(): Promise<LoaderResult<WebhookSummary[]>> {
  return fetchJson<unknown, WebhookSummary[]>("/api/v1/admin/webhooks", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.webhooks",
    mapResponse: (p) => getArrayPayload(p) as WebhookSummary[] | null,
  });
}

export async function getWebhookDeliveries(webhookId: string): Promise<LoaderResult<WebhookDelivery[]>> {
  return fetchJson<unknown, WebhookDelivery[]>(`/api/v1/admin/webhooks/${webhookId}/deliveries`, [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.webhooks.deliveries",
    mapResponse: (p) => getArrayPayload(p) as WebhookDelivery[] | null,
  });
}

// ── Admin Tenant Detail loaders ───────────────────────────────────────────────

export type AdminTenantDetail = {
  id: string;
  name: string;
  domain: string;
  edition: string;
  status: string;
  region: string;
  settings: Record<string, unknown>;
};

export type AdminTenantModuleUsage = {
  module: string;
  enabled: string;
  users: number;
  lastActivity: string;
  usage: string;
};

export async function getAdminTenantDetail(id: string): Promise<LoaderResult<AdminTenantDetail | null>> {
  return fetchJson<unknown, AdminTenantDetail | null>(`/api/v1/admin/tenants/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "admin.tenant.detail",
    mapResponse: (p) => (isRecord(p) ? (p as AdminTenantDetail) : null),
  });
}

export async function getAdminTenantModules(id: string): Promise<LoaderResult<AdminTenantModuleUsage[]>> {
  return fetchJson<unknown, AdminTenantModuleUsage[]>(`/api/v1/admin/tenants/${id}/config`, [], {
    revalidateSeconds: 120,
    telemetryKey: "admin.tenant.modules",
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      const modules = getArrayPayload(p.modules ?? p.data ?? p);
      if (!modules) return [];
      return modules.filter(isRecord).map((m) => ({
        module: String(m.module ?? m.name ?? "Unknown"),
        enabled: m.enabled === true || m.enabled === "Yes" ? "Yes" : "No",
        users: typeof m.users === "number" ? m.users : 0,
        lastActivity: typeof m.lastActivity === "string" ? m.lastActivity : "—",
        usage: typeof m.usage === "string" ? m.usage : "—",
      }));
    },
  });
}

// ── Project sub-resource loaders ──────────────────────────────────────────────

export type ProjectEscalationRow = {
  escalationId: string;
  project: string;
  issue: string;
  severity: string;
  escalatedTo: string;
  raisedDate: string;
  status: string;
};

export async function getProjectEscalations(): Promise<LoaderResult<ProjectEscalationRow[]>> {
  return fetchJson<unknown, ProjectEscalationRow[]>("/api/v1/projects/escalations", [], {
    revalidateSeconds: 60,
    telemetryKey: "projects.escalations",
    mapResponse: (p) => getArrayPayload(p) as ProjectEscalationRow[] | null,
  });
}

export type ProjectBeneficiaryRow = {
  id: string;
  name: string;
  project: string;
  district: string;
  category: string;
  verified: string;
  disbursement: string;
};

export async function getProjectBeneficiaries(): Promise<LoaderResult<ProjectBeneficiaryRow[]>> {
  return fetchJson<unknown, ProjectBeneficiaryRow[]>("/api/v1/projects/beneficiaries", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.beneficiaries",
    mapResponse: (p) => getArrayPayload(p) as ProjectBeneficiaryRow[] | null,
  });
}

export type ProjectDprRow = {
  dprNo: string;
  projectTitle: string;
  submittedBy: string;
  submittedDate: string;
  estimatedCost: string;
  status: string;
  reviewingAuthority: string;
};

export async function getProjectDprs(): Promise<LoaderResult<ProjectDprRow[]>> {
  return fetchJson<unknown, ProjectDprRow[]>("/api/v1/projects/dprs", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.dprs",
    mapResponse: (p) => getArrayPayload(p) as ProjectDprRow[] | null,
  });
}

export type ProjectWbsNode = {
  id: string;
  name: string;
  status: string;
  parentId: string | null;
};

export async function getProjectWbs(): Promise<LoaderResult<ProjectWbsNode[]>> {
  return fetchJson<unknown, ProjectWbsNode[]>("/api/v1/projects/wbs", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.wbs",
    mapResponse: (p) => getArrayPayload(p) as ProjectWbsNode[] | null,
  });
}

export type ProjectDelayRow = {
  project: string;
  originalDeadline: string;
  revisedDeadline: string;
  delayDays: number;
  cause: string;
  rag: string;
};

export async function getProjectDelayAnalysis(): Promise<LoaderResult<ProjectDelayRow[]>> {
  return fetchJson<unknown, ProjectDelayRow[]>("/api/v1/projects/delay-analysis", [], {
    revalidateSeconds: 120,
    telemetryKey: "projects.delay-analysis",
    mapResponse: (p) => getArrayPayload(p) as ProjectDelayRow[] | null,
  });
}
// ── Project Task loader (per-project) ─────────────────────────────────────────

export type ProjectTaskRow = {
  id: string;
  projectId: string;
  parentTaskId: string | null;
  name: string;
  description: string | null;
  status: string;
  progressPct: number;
  weightPct: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

export async function getProjectTasks(projectId: string): Promise<LoaderResult<ProjectTaskRow[]>> {
  return fetchJson<unknown, ProjectTaskRow[]>(`/api/v1/projects/${projectId}/tasks`, [], {
    revalidateSeconds: 30,
    telemetryKey: "projects.tasks",
    mapResponse: (p) => {
      if (p && typeof p === "object" && "data" in p && Array.isArray((p as any).data)) {
        return (p as any).data as ProjectTaskRow[];
      }
      return getArrayPayload(p) as ProjectTaskRow[] | null;
    },
  });
}

// ── Project Member loader (per-project) ──────────────────────────────────────

export type ProjectMemberRow = {
  id: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: string;
};

export async function getProjectMembers(projectId: string): Promise<LoaderResult<ProjectMemberRow[]>> {
  return fetchJson<unknown, ProjectMemberRow[]>(`/api/v1/projects/${projectId}/members`, [], {
    revalidateSeconds: 60,
    telemetryKey: "projects.members",
    mapResponse: (p) => {
      if (p && typeof p === "object" && "data" in p && Array.isArray((p as any).data)) {
        return (p as any).data as ProjectMemberRow[];
      }
      return getArrayPayload(p) as ProjectMemberRow[] | null;
    },
  });
}

// ── Project Risk loader (per-project) ────────────────────────────────────────

export type ProjectRiskRow = {
  id: string;
  projectId: string;
  title: string;
  category: string;
  probability: string;
  impact: string;
  riskScore: number;
  status: string;
  mitigationPlan: string | null;
  createdAt: string;
};

export async function getProjectRisks(projectId: string): Promise<LoaderResult<ProjectRiskRow[]>> {
  return fetchJson<unknown, ProjectRiskRow[]>(`/api/v1/projects/${projectId}/risks`, [], {
    revalidateSeconds: 60,
    telemetryKey: "projects.risks",
    mapResponse: (p) => {
      if (p && typeof p === "object" && "data" in p && Array.isArray((p as any).data)) {
        return (p as any).data as ProjectRiskRow[];
      }
      return getArrayPayload(p) as ProjectRiskRow[] | null;
    },
  });
}


// ── Analytics sub-resource loaders ────────────────────────────────────────────

export type AnalyticsKpiRow = {
  kpiName: string;
  category: string;
  currentValue: string;
  target: string;
  trend: string;
  owner: string;
};

export async function getAnalyticsKpis(): Promise<LoaderResult<AnalyticsKpiRow[]>> {
  return fetchJson<unknown, AnalyticsKpiRow[]>("/api/v1/analytics/kpis", [], {
    revalidateSeconds: 120,
    telemetryKey: "analytics.kpis",
    mapResponse: (p) => getArrayPayload(p) as AnalyticsKpiRow[] | null,
  });
}

export type AnalyticsDataWarehouseRow = {
  dataset: string;
  lastRefresh: string;
  records: string;
  size: string;
  qualityScore: string;
  status: string;
};

export async function getAnalyticsDataWarehouse(): Promise<LoaderResult<AnalyticsDataWarehouseRow[]>> {
  return fetchJson<unknown, AnalyticsDataWarehouseRow[]>("/api/v1/analytics/data-warehouse", [], {
    revalidateSeconds: 300,
    telemetryKey: "analytics.data-warehouse",
    mapResponse: (p) => getArrayPayload(p) as AnalyticsDataWarehouseRow[] | null,
  });
}

export type AnalyticsAiInsightRow = {
  insightTitle: string;
  module: string;
  confidence: string;
  generatedDate: string;
  actionRecommended: string;
  status: string;
};

export async function getAnalyticsAiInsights(): Promise<LoaderResult<AnalyticsAiInsightRow[]>> {
  return fetchJson<unknown, AnalyticsAiInsightRow[]>("/api/v1/analytics/ai-insights", [], {
    revalidateSeconds: 60,
    telemetryKey: "analytics.ai-insights",
    mapResponse: (p) => getArrayPayload(p) as AnalyticsAiInsightRow[] | null,
  });
}

// ── My Approvals unified inbox loader ─────────────────────────────────────────

export type MyApprovalItem = {
  id: string;
  taskId: string;
  instanceName: string;
  refType: string;
  refId: string;
  module: string;
  status: string;
  assignedAt: string;
  dueDate: string | null;
  link: string;
};

export async function getMyApprovals(page = 1, pageSize = 15, sortBy = "date", sortDir: "asc" | "desc" = "desc"): Promise<LoaderResult<MyApprovalItem[]>> {
  const params = new URLSearchParams({
    status: "pending",
    limit: String(Math.min(pageSize, 200)),
    offset: String((page - 1) * pageSize),
  });
  return fetchJson<unknown, MyApprovalItem[]>(
    `/api/v1/workflow/tasks?${params.toString()}`,
    [] as MyApprovalItem[],
    {
      revalidateSeconds: 30,
      telemetryKey: "approvals.my",
      mapResponse: (payload) => {
        const rows = getArrayPayload(payload);
        if (!rows) return [];
        return rows.filter(isRecord).map((row) => {
          const refType = String(row.refType ?? row.ref_type ?? "");
          const module = refType.split("_")[0] || "workflow";
          const refId = String(row.refId ?? row.ref_id ?? "");
          const taskId = String(row.id ?? "");
          return {
            id: taskId,
            taskId,
            instanceName: String(row.name ?? row.instanceName ?? "Approval Task"),
            refType,
            refId,
            module,
            status: String(row.status ?? "pending"),
            assignedAt: String(row.createdAt ?? row.created_at ?? ""),
            dueDate: row.dueAt ? String(row.dueAt) : row.due_at ? String(row.due_at) : null,
            link: buildApprovalLink(module, refType, refId, taskId),
          };
        });
      },
    },
  );
}

function buildApprovalLink(module: string, refType: string, refId: string, taskId: string): string {
  switch (refType) {
    case "leave_app":
      return `/hr/leave/approvals`;
    case "payroll_run":
      return `/hr/payroll`;
    case "procurement_indent":
      return `/procurement/indents/${refId}`;
    case "procurement_po":
      return `/procurement/orders/${refId}`;
    case "finance_bill":
      return `/finance/bills/${refId}`;
    case "estab_file":
      return `/estab/files/${refId}`;
    default:
      return `/workflow/tasks`;
  }
}

// ── SVC-129 Service Catalogue loaders (helpdesk-service) ─────────────────────

export type CatalogueFormField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  options?: string[];
};
export type CatalogueStage = { key: string; name: string; assigneeRole?: string | null };
export type CatalogueOla = { id: string; name: string; kind: string; provider: string; targetMinutes: number };

export type CatalogueOfferingSummary = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  status: string;
  approvalRequired: boolean;
  defaultPriority: string;
  requestFormSchema: CatalogueFormField[];
  fulfilmentStages: CatalogueStage[];
  olas?: CatalogueOla[];
};

export type ServiceRequestSummary = {
  id: string;
  offeringId: string;
  ticketId: string | null;
  requestedBy: string;
  status: string;
  currentStage: string | null;
  slaStatus: string;
  resolutionDeadline: string | null;
  breachEscalatedAt: string | null;
  createdAt: string;
};

export type RequestBreachReport = {
  data: ServiceRequestSummary[];
  summary: { breached: number; atRisk: number; escalated: number; total: number };
};

/** Browse the service catalogue (active offerings). */
export async function getCatalogueOfferings(): Promise<LoaderResult<CatalogueOfferingSummary[]>> {
  return fetchJson<unknown, CatalogueOfferingSummary[]>("/api/v1/helpdesk/catalogue/offerings", [], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.catalogue.offerings",
    mapResponse: (p) => ((p as { data?: CatalogueOfferingSummary[] } | null)?.data ?? []),
  });
}

/** Offering detail incl. request form schema, fulfilment stages and OLAs. */
export async function getCatalogueOffering(id: string): Promise<LoaderResult<CatalogueOfferingSummary | null>> {
  return fetchJson<unknown, CatalogueOfferingSummary | null>(`/api/v1/helpdesk/catalogue/offerings/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.catalogue.offering",
    mapResponse: (p) => ((p as { data?: CatalogueOfferingSummary } | null)?.data ?? null),
  });
}

/** The current user's service requests (self-service portal — my requests). */
export async function getMyServiceRequests(): Promise<LoaderResult<ServiceRequestSummary[]>> {
  return fetchJson<unknown, ServiceRequestSummary[]>("/api/v1/helpdesk/catalogue/requests?mine=true", [], {
    revalidateSeconds: 15,
    telemetryKey: "helpdesk.catalogue.my_requests",
    mapResponse: (p) => ((p as { data?: ServiceRequestSummary[] } | null)?.data ?? []),
  });
}

/** SLA-breach report over service requests. */
export async function getRequestBreachReport(): Promise<LoaderResult<RequestBreachReport>> {
  const empty: RequestBreachReport = { data: [], summary: { breached: 0, atRisk: 0, escalated: 0, total: 0 } };
  return fetchJson<unknown, RequestBreachReport>("/api/v1/helpdesk/catalogue/requests/breaches", empty, {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.catalogue.breaches",
    mapResponse: (p) => {
      const r = p as Partial<RequestBreachReport> | null;
      if (!r || !r.summary) return empty;
      return { data: r.data ?? [], summary: r.summary };
    },
  });
}


// ---- Procurement: Vendor Scorecard ----------------------------------------
export type VendorScorecard = {
  vendorId: string;
  overallRating: number;
  ratingBand: string;
  totalOrders: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  qualityRejections: number;
  slaBreaches: number;
  deliveryScore: number;
  qualityScore: number;
  slaScore: number;
  lastUpdated: string | null;
};

export async function getProcurementVendorScorecard(vendorId: string): Promise<LoaderResult<VendorScorecard | null>> {
  return fetchJson<unknown, VendorScorecard | null>(
    "/api/v1/procurement/vendors/" + encodeURIComponent(vendorId) + "/scorecard",
    null,
    {
      revalidateSeconds: 120,
      telemetryKey: "procurement.vendor.scorecard",
      mapResponse: (p) => ((p as { data?: VendorScorecard } | null)?.data ?? null),
    }
  );
}

// ---- Procurement: Annual Plans --------------------------------------------
export type AnnualPlanSummary = {
  id: string;
  planYear: number;
  title: string;
  department: string;
  status: string;
  totalEstimatedMinor: number;
  itemCount: number;
  createdAt: string;
};

export async function getProcurementAnnualPlans(query?: { department?: string; year?: number }): Promise<LoaderResult<AnnualPlanSummary[]>> {
  const params = new URLSearchParams();
  if (query?.department) params.set("department", query.department);
  if (query?.year) params.set("year", String(query.year));
  const qs = params.toString() ? "?" + params.toString() : "";
  return fetchJson<unknown, AnnualPlanSummary[]>(
    "/api/v1/procurement/plans" + qs,
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "procurement.plans",
      mapResponse: (p) => getArrayPayload(p) as AnnualPlanSummary[] | null,
    }
  );
}

export type AnnualPlanLine = {
  id: string;
  itemCode: string;
  description: string;
  aggregatedQty: number;
  uom: string;
  procurementCategory: string;
  procurementMethod: string;
  budgetLine: string | null;
  estimatedValueMinor: string;
  timelineQuarter: string | null;
  packageGroup: string | null;
  tenderId: string | null;
};

// L1/L2 fix: GET /v1/procurement/plans/:id has been a real, working backend
// endpoint (services/procurement-service/src/modules/planning/routes.ts) since
// this module shipped, but there was no frontend loader — and therefore no
// /procurement/planning/[id] page — to call it. The plans LIST page has always
// linked to /procurement/planning/{plan.id}, so every one of those links 404'd.
export type AnnualPlanDetail = Omit<AnnualPlanSummary, "itemCount"> & {
  planNo: string;
  currency: string;
  notes: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  lines: AnnualPlanLine[];
};

export async function getProcurementAnnualPlanById(id: string): Promise<LoaderResult<AnnualPlanDetail | null>> {
  return fetchJson<unknown, AnnualPlanDetail | null>(
    "/api/v1/procurement/plans/" + encodeURIComponent(id),
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "procurement.plan.detail",
      mapResponse: (p) => {
        const data = isRecord(p) && "data" in p ? (p as { data: unknown }).data : null;
        return isRecord(data) ? (data as unknown as AnnualPlanDetail) : null;
      },
    }
  );
}

// ---- Procurement: Tender Documents ----------------------------------------
export type TenderDocumentSummary = {
  id: string;
  tenderId: string;
  docType: string;
  title: string;
  storageRef: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
};

export async function getProcurementTenderDocuments(tenderId: string): Promise<LoaderResult<TenderDocumentSummary[]>> {
  return fetchJson<unknown, TenderDocumentSummary[]>(
    "/api/v1/procurement/tenders/" + encodeURIComponent(tenderId) + "/documents",
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "procurement.tender.documents",
      mapResponse: (p) => getArrayPayload(p) as TenderDocumentSummary[] | null,
    }
  );
}

// ---- Procurement: PO Amendments -------------------------------------------
export type POAmendmentSummary = {
  id: string;
  poId: string;
  amendmentType: string;
  effectiveDate: string | null;
  deltaAmountMinor: number | null;
  reason: string;
  status: string;
  createdAt: string;
};

export async function getProcurementPOAmendments(poId: string): Promise<LoaderResult<POAmendmentSummary[]>> {
  return fetchJson<unknown, POAmendmentSummary[]>(
    "/api/v1/procurement/pos/" + encodeURIComponent(poId) + "/amendments",
    [],
    {
      revalidateSeconds: 60,
      telemetryKey: "procurement.po.amendments",
      mapResponse: (p) => getArrayPayload(p) as POAmendmentSummary[] | null,
    }
  );
}
