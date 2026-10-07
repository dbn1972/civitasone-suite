import { z } from "zod";
import { GL_JOURNAL_LIMIT } from "@/lib/financeLimits";
import { normalizeHexColor } from "@/lib/orgLevels";
import { pathSeg } from "@/lib/pathSegment";
import { mapEstabScannedDocuments, estabScannedDocumentsPath, type EstabScannedDocument } from "@/lib/estab/scannedDocuments";
import { mapScannedDocuments, scannedDocumentsPath, type ScannedDocument, type ScannedDocumentsKind } from "@/lib/finance/scannedDocuments";
import type { AuditParaEvent, GlLinesPagination, GlLinesTotals, PaymentContext } from "@/lib/finance/workflowTypes";
import { HR_AUDIT_SERVICES } from "@/app/(app)/hr/audit-log/auditResource";
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
  CRMCampaignRoiSummary,
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
  FinanceDebtDetail,
  FinanceChangeRequest,
  FinanceSettings,
  FinanceSchemeSummary,
  FinanceDemandSummary,
  FinanceAuditParaSummary,
  DisciplinaryCaseDetail,
  DisciplinaryCaseEvent,
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
  SchemeDetail,
  GrantsDashboard,
  GrantSummary,
  GrantDetail,
  GranteeSummary,
  GranteeDetail,
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
  SalarySlipDetailSchema,
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
  chatConversationItemSchema,
  chatConversationsCountSchema,
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
  FinanceDebtDetailSchema,
  FinanceChangeRequestListSchema,
  FinanceSettingsSchema,
  FinanceSchemeSummarySchema,
  FinanceSchemeSummaryListSchema,
  FinanceDemandSummaryListSchema,
  FinanceAuditParaSummarySchema,
  FinanceAuditParaSummaryListSchema,
  DisciplinaryCaseDetailSchema,
  DisciplinaryCaseEventListSchema,
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
  SchemeDetailSchema,
  GrantsDashboardSchema,
  GrantSummaryListSchema,
  GrantDetailSchema,
  GranteeSummaryListSchema,
  GranteeDetailSchema,
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
  SessionSummaryListSchema,
  SessionDetailSchema,
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
import { fetchJson, type LoaderResult, type LoaderSource } from "./apiClient";
import { mapBillingSettings, mapOfflinePayments, mapReminderStatus, type BillingSettingsView, type OfflinePaymentView, type ReminderView } from "@/lib/admin/invoiceOps";
import { mapDiscoveryRegistry as mapDiscoveryRegistryImpl, type DiscoveryRegistry as DiscoveryRegistryModel } from "@/lib/admin/discoveryRegistry";
import { formatMoney } from "@/lib/formatters";
import { toApiEndpointRow, toEditionRow, type ApiEndpointRow, type EditionRow } from "@/lib/admin/monitoring";
import {
  mapAdminUserSummaries,
  mapAssetSummaries,
  parseMinorString,
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
  mapLegalOpinionSummaries,
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
    // GAP-HR-AUDIT-LOG-06: previously defaulted an ambiguous/unrecognised
    // outcome to "success" (only error/critical severity flipped it to
    // "failure") -- an audit trail must never call an action successful
    // when it isn't sure. Flipped the fallback's polarity: only a
    // positively-known-good severity reads as success now.
    const outcome: "success" | "failure" =
      row.outcome === "success" || row.outcome === "failure"
        ? row.outcome
        : row.severity === "info" || row.severity === "warning"
          ? "success"
          : "failure";
    if (!actor || !action) continue;
    // GAP-HR-AUDIT-LOG-03: surface the event's own timestamp -- occurredAt
    // for the raw audit-service row shape, timestamp for an already-
    // flattened one -- previously dropped entirely by this mapper.
    const at = toText(row.occurredAt) ?? toText(row.timestamp);
    // GAP-HR-AUDIT-LOG-05: the raw audit-service row carries the audited
    // entity's type in payload.resourceType and its id as `target` (the
    // flattened /v1 shape has neither a payload nor a separate id) -- kept
    // so the page can render "Type · id" and link to the entity.
    const rowPayload = isRecord(row.payload) ? row.payload : null;
    const resourceType = (rowPayload ? toText(rowPayload.resourceType) : null) ?? undefined;
    const resourceId = toText(row.resourceId) ?? (rowPayload ? toText(rowPayload.resourceId) : null) ?? toText(row.target) ?? undefined;
    // GAP-AUDIT-HOME-03: keep the event's own id so the Event Log can show an
    // event reference; previously discarded by this mapper.
    const eventId = toText(row.id) ?? undefined;
    mapped.push({ actor, action, resource, outcome, at, ...(resourceType ? { resourceType } : {}), ...(resourceId ? { resourceId } : {}), ...(eventId ? { id: eventId } : {}) });
  }
  // GAP-HR-AUDIT-LOG-01: an empty but VALID array must stay a clean "no
  // records", never the error badge -- only fall back to null when the
  // payload had rows but none of them were parseable (a genuine shape-drift
  // signal worth flagging as an error), matching mapAuditRows's own sibling
  // mappers' convention for a real parse failure.
  return rows.length > 0 && mapped.length === 0 ? null : mapped;
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

// Exported for unit tests. GAP-HELPDESK-INTERNAL-04: verifies unknown statuses
// are kept rather than dropped.
export function mapTickets(payload: unknown): HelpdeskTicketSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: HelpdeskTicketSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id) ?? toText(row.ticketNo);
    const subject = toText(row.subject) ?? toText(row.title);
    if (!id || !subject) continue;
    // GAP-HELPDESK-INTERNAL-04: do NOT drop a row whose status/priority is
    // outside the known enum (e.g. "Pending", "On Hold", "Closed"). Dropping
    // them silently hid real tickets from the queue entirely. Keep the raw
    // value so the table and tabs can surface it; the display layer humanises
    // and colours unknown values conservatively.
    const priority = (toText(row.priority) ?? "Medium") as HelpdeskTicketSummary["priority"];
    const status = (toText(row.status) ?? "Open") as HelpdeskTicketSummary["status"];
    mapped.push({ id, subject, priority, status });
  }
  // A tenant with zero matching tickets is a legitimate empty state, not a
  // mapping failure — returning null here made fetchJson report source:"error"
  // (and show the "data source" warning badge) for an ordinary empty queue.
  return mapped;
}

/**
 * Canonicalise a payment status string (case / underscore / hyphen
 * insensitive) onto the four PaymentSummary statuses. Backend states that are
 * "accepted but not yet released" (initiated, approved) read as Queued.
 * Returns null for a genuinely unknown status.
 */
export function normalisePaymentStatus(raw: unknown): PaymentSummary["status"] | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  switch (key) {
    case "released":
    case "completed":
      return "Released";
    case "pending approval":
      return "Pending Approval";
    case "failed":
      return "Failed";
    case "queued":
    case "initiated":
    case "approved":
      return "Queued";
    default:
      return null;
  }
}

// Exported for unit tests. GAP-FINANCE-PAYMENTS-02: a valid array -- including
// an EMPTY one for a tenant with no payments -- is a successful load. Returning
// null made fetchJson report source:"error" ("Couldn't load") for an ordinary
// empty register.
export function mapPayments(payload: unknown): PaymentSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;

  const mapped: PaymentSummary[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const referenceId = toText(row.referenceId) ?? toText(row.ref) ?? toText(row.id);
    const beneficiary = toText(row.beneficiary) ?? toText(row.payee);
    const amountDisplay = toText(row.amountDisplay) ?? toText(row.amount);
    const status = normalisePaymentStatus(row.status);
    if (!referenceId || !beneficiary || !amountDisplay || !status) continue;
    // GAP-FINANCE-PAYMENTS-05: exact paise string (when the API supplies it) so the
    // register can sort/format numerically instead of comparing "₹…" display text.
    const amountMinorRaw = toText(row.amountMinor);
    const amountMinor = amountMinorRaw && /^\d+$/.test(amountMinorRaw) ? amountMinorRaw : null;
    mapped.push({
      ...(id ? { id } : {}),
      referenceId,
      beneficiary,
      amountDisplay,
      ...(amountMinor ? { amountMinor } : {}),
      status,
    });
  }
  // GAP-FINANCE-TREASURY-E-PAYMENTS-04: an empty array is a successful empty
  // register, but rows that ALL failed mapping (e.g. only unknown statuses) are
  // a contract break and must surface as a load error, not as "No payments".
  if (rows.length > 0 && mapped.length === 0) return null;
  return mapped;
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

// Exported (not a private closure) so it's directly unit testable without
// mocking fetchJson -- see loaders.employees.test.ts.
//
// IMPORTANT: return the mapped array as-is, even when empty. A tenant with
// zero employees is a normal, successful state (hrms-service replies 200
// with {data: [], pagination: {...}}), not a parse failure -- fetchJson
// treats a `null` mapResponse return as source:"error" (invalid_payload),
// which renders the HR dashboard's page-level "Couldn't load" banner and
// the employee table's "We couldn't load employees" state for a perfectly
// healthy empty-tenant response. Same regression as mapContractsListRows
// (fixup commit b6bd6740 / PR #813) and the generic mapModuleRows (see its
// comment above moduleLoader()) -- this is the same `mapped.length > 0 ?
// mapped : null` bug, independently present here. Only return null when the
// payload itself couldn't be understood as a row list at all (getArrayPayload
// returns null); that's a genuine invalid-payload failure, distinct from a
// well-formed empty list.
export function mapEmployees(payload: unknown): EmployeeSummary[] | null {
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
    // GAP-HR-EMPLOYEES-05: employeeType is already in the validated payload
    // (employeeSummarySchema) and already returned by the backend -- this
    // re-mapping just never forwarded it, so the list page could never show
    // a Type column no matter what the API sent.
    const employeeType = toText(row.employeeType);
    // GAP-HR-DASHBOARD-04: real columns already returned by the API
    // (employee/queries.ts's listEmployees) but previously dropped here --
    // `payGrade` (not `grade`) to match hr/dashboard/page.tsx's pre-existing
    // EmpRow contract, which already expected this exact field name.
    const dateOfJoining = toText(row.dateOfJoining);
    const payGrade = toText(row.grade) ?? toText(row.payGrade);
    if (!id || !name) continue;
    mapped.push({
      id, name, department, status,
      ...(empNo ? { employeeNo: empNo } : {}),
      ...(employeeType ? { employeeType } : {}),
      ...(dateOfJoining ? { dateOfJoining } : {}),
      ...(payGrade ? { payGrade } : {}),
    });
  }
  return mapped;
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
    const dueAt = toText(row.dueAt) ?? toText(row.dueDate);
    mapped.push({ id, referenceId, owner, dueDisplay, ...(dueAt ? { dueAt } : {}) });
  }
  // GAP-PROCUREMENT-APPROVALS-02: return the mapped array as-is, even when
  // empty. A tenant with zero pending approvals is a normal, successful 200
  // ({data: []}), not a parse failure. fetchJson treats a `null` mapResponse
  // as source:"error" (invalid_payload), so the old `mapped.length > 0 ?
  // mapped : null` rendered the load ErrorState for a genuinely empty queue
  // instead of the "No pending approvals" EmptyState. Only return null when
  // the payload could not be read as a row list at all (getArrayPayload
  // returned null above). Same regression class as mapEmployees /
  // mapContractsListRows.
  return mapped;
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
    const id = toText(row.id);
    const parentId = toText(row.parentId);
    mapped.push({
      code, name, type, currency, balanceDisplay, status,
      ...(id ? { id } : {}),
      ...(parentId ? { parentId } : {}),
      ...(row.isControl === true ? { isControl: true } : {}),
    });
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

/**
 * HR-scoped audit log. GAP-HR-AUDIT-LOG-08: the `resourceType=...` param
 * this used to send was silently dropped -- GET /audit/events on
 * audit-service only ever recognised tenantId/from/to/type, so it did
 * nothing at all (not "excludes most HR modules" as originally suspected;
 * genuinely inert). Removed rather than left in place claiming a scope it
 * never enforced. A real resource-type filter needs a small audit-service
 * change (matching the actor/payload JSONB columns) not made in this pass;
 * `from`/`to` are real, backend-enforced filters already.
 */
export async function getHrAuditLog(
  limit = 50,
  offset = 0,
  filters?: { from?: string; to?: string; resourceType?: string; actor?: string },
): Promise<LoaderResult<AuditRowSummary[]>> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  // GAP-HR-AUDIT-LOG-08: scope to the services whose events are HR actions
  // (audit-service filters on payload.service) instead of the whole tenant.
  params.set("service", HR_AUDIT_SERVICES.join(","));
  if (filters?.resourceType) params.set("resourceType", filters.resourceType);
  if (filters?.actor) params.set("actor", filters.actor);
  return fetchJson(`/api/audit/events?${params.toString()}`, [] as AuditRowSummary[], {
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

/**
 * GAP-HELPDESK-INTERNAL-DETAIL-01/04: a single internal ticket's detail. The id
 * is encoded with encodeURIComponent so a crafted id segment cannot alter the
 * request path (DETAIL-04). `description`/`createdAt`/`requester` are mapped
 * when present so the detail page can show what was asked (DETAIL-01).
 */
export type InternalHelpdeskTicketDetail = {
  id: string;
  subject: string;
  priority: string;
  status: string;
  description?: string;
  dueDate?: string;
  slaStatus?: string;
  assignee?: string;
  createdAt?: string;
  requester?: string;
  ticketNo?: string;
};

export async function getInternalHelpdeskTicketById(id: string): Promise<LoaderResult<InternalHelpdeskTicketDetail | null>> {
  return fetchJson<unknown, InternalHelpdeskTicketDetail | null>(
    `/api/v1/helpdesk/tickets/${encodeURIComponent(id)}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "helpdesk.internal.detail",
      mapResponse: (payload) => {
        const raw =
          payload && typeof payload === "object" && "data" in payload
            ? (payload as { data: unknown }).data
            : payload;
        if (!raw || typeof raw !== "object") return null;
        const t = raw as Record<string, unknown>;
        if (typeof t.id !== "string") return null;
        const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
        return {
          id: t.id,
          subject: str(t.subject) ?? "",
          priority: str(t.priority) ?? "normal",
          status: str(t.status) ?? "open",
          description: str(t.description),
          dueDate: str(t.dueDate),
          slaStatus: str(t.slaStatus),
          assignee: str(t.assignee),
          createdAt: str(t.createdAt),
          requester: str(t.requester) ?? str(t.requestedBy),
          ticketNo: str(t.ticketNo),
        } satisfies InternalHelpdeskTicketDetail;
      },
    },
  );
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
 * GAP-TENANT-ADMIN-ORG-TYPE-01: the tenant's current organisation type, read
 * from the tenant record's settings (tenant-service /v1/tenants/current). Also
 * returns the id + the full current settings object so a PATCH can MERGE
 * orgType into existing settings rather than replace the whole object. Falls
 * back to a null orgType (not a fabricated default) when the backend is
 * unreachable or the setting is unset.
 */
export async function getCurrentTenantOrgType(): Promise<LoaderResult<{ tenantId: string | null; orgType: string | null; settings: Record<string, unknown> }>> {
  return fetchJson<unknown, { tenantId: string | null; orgType: string | null; settings: Record<string, unknown> }>(
    "/api/v1/tenants/current",
    { tenantId: null, orgType: null, settings: {} },
    {
      revalidateSeconds: 30,
      telemetryKey: "tenant.org_type",
      mapResponse: (p) => {
        const view = (p && typeof p === "object" && "data" in p ? (p as { data?: unknown }).data : p) as
          | { tenantId?: unknown; id?: unknown; settings?: unknown }
          | null;
        if (!view || typeof view !== "object") return null;
        const settings = (view.settings && typeof view.settings === "object" ? view.settings : {}) as Record<string, unknown>;
        const orgType = typeof settings.orgType === "string" ? settings.orgType : null;
        const tenantId = typeof view.tenantId === "string" ? view.tenantId : typeof view.id === "string" ? view.id : null;
        return { tenantId, orgType, settings };
      },
    },
  );
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

export type ReadinessGate = {
  key: string;
  passed: boolean;
};

export type TenantAdminReadiness = {
  overall: number;
  productionReady: boolean;
  allGreen: boolean;
  // GAP-TENANT-ADMIN-READINESS-01: per-gate results come from admin-service's
  // /v1/admin/health/readiness `gates` map (ProductionReadiness.gates). When
  // the backend omits a gate map (older deployments), this is an empty array
  // and the page shows an honest "detailed checks not available" state rather
  // than a hard-coded Pass/Fail list.
  gates: ReadinessGate[];
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

export function mapReadiness(payload: unknown): TenantAdminReadiness | null {
  if (!isRecord(payload)) return null;
  const overall = typeof payload.overall === "number" ? Math.round(payload.overall) : null;
  if (overall === null) return null;
  // GAP-TENANT-ADMIN-READINESS-01: map the backend `gates` object
  // (Record<string, boolean>) into a stable ordered array. Non-boolean
  // values are ignored so a malformed gate never renders a fake status.
  const gates: ReadinessGate[] = [];
  if (isRecord(payload.gates)) {
    for (const [key, value] of Object.entries(payload.gates)) {
      if (typeof value === "boolean") gates.push({ key, passed: value });
    }
  }
  return {
    overall,
    productionReady: payload.productionReady === true,
    allGreen: payload.allGreen === true,
    gates,
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

// GAP-HR-EMPLOYEES-04: `q` was never threaded through here even though the
// backend (employeeListQuery/listEmployees) has supported it for a while
// (built for GAP-HR-SF-06's EntityPicker) -- so the employee list page's
// only "search" was EmployeesTable's client-side DataTable filter, which
// can only ever see the current 50-row server page. An employee on page 3
// was simply unreachable by name from page 1's search box. Now forwards a
// real server-side search across the whole tenant.
export async function getEmployees(limit = 50, offset = 0, employeeType?: string, q?: string, status?: string): Promise<LoaderResult<EmployeeSummary[]>> {
  const typeQs = employeeType ? `&employeeType=${encodeURIComponent(employeeType)}` : "";
  const qQs = q ? `&q=${encodeURIComponent(q)}` : "";
  // GAP-HR-EMPLOYEES-06: server-side status filter (canonical lowercase status).
  const statusQs = status ? `&status=${encodeURIComponent(status)}` : "";
  return fetchJson(`/api/v1/hrms/employees?limit=${limit}&offset=${offset}${typeQs}${qQs}${statusQs}`, [] as EmployeeSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "hr.employees",
    responseSchema: employeesListSchema,
    mapResponse: mapEmployees,
  });
}

/**
 * Self-service profile for the logged-in employee (no admin role needed).
 *
 * A 404 here has documented, known semantics -- "No employee record linked
 * to your user" -- which is a normal, expected response for a non-employee
 * account (an admin/test/tenant-admin user browsing HR screens), not a
 * fetch/parse failure. Left alone, fetchJson's generic !response.ok
 * handling reports that as source:"error" like any other failure (see
 * apiClient.ts's `status` field doc comment, added for exactly this kind of
 * distinction -- UX-009 follow-up), which then trips every caller that
 * treats source:"error" as "something is broken" -- e.g. hr/dashboard's
 * page-level banner and (before this fix) its employee table, even though
 * `profile` there is only ever used as an optional greeting-name fallback
 * with no error UI of its own. So this loader normalizes a 404 specifically
 * into a successful "no profile" result instead of letting it read as a
 * failure. Any other status (401, 5xx, network error) is left as a genuine
 * source:"error" -- unlike a 404, those really mean "we don't know," not
 * "we know you have none."
 */
export async function getMyProfile(): Promise<LoaderResult<{ id: string; name: string; department: string; employeeNo: string; status: string; designation: string } | null>> {
  const result = await fetchJson<Record<string, unknown>, { id: string; name: string; department: string; employeeNo: string; status: string; designation: string } | null>(
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
  if (result.source === "error" && result.status === 404) {
    return { data: null, source: "api", status: 404 };
  }
  return result;
}

export type MyLeaveBalanceItem = { leaveTypeId: string; fy: string; total: number; balance: number; used: number };

/**
 * Self-service leave balance for the logged-in employee -- no admin/manager
 * role required (see services/hrms-service/src/modules/self-service/
 * routes.ts's GET /v1/hrms/me/leave-balance, scoped server-side to the
 * caller's own linked employee record). Used by hr/dashboard's employee-role
 * view, which must NOT call the HR-admin-only getHRDashboard() for a plain
 * "employee" viewer (that 403s -- see page.tsx).
 */
export async function getMyLeaveBalance(): Promise<LoaderResult<MyLeaveBalanceItem[]>> {
  return fetchJson<{ data: unknown }, MyLeaveBalanceItem[]>(
    "/api/v1/hrms/me/leave-balance",
    [] as MyLeaveBalanceItem[],
    {
      revalidateSeconds: 30,
      telemetryKey: "hr.me.leave_balance",
      mapResponse: (raw) => {
        if (!raw || !Array.isArray(raw.data)) return [];
        return raw.data as MyLeaveBalanceItem[];
      },
    },
  );
}

export type MyAttendanceItem = { date: string; status: string; inTime: string | null; outTime: string | null };

/** Self-service "my attendance this month" — same scoping as getMyLeaveBalance above. */
export async function getMyAttendance(limit = 31): Promise<LoaderResult<MyAttendanceItem[]>> {
  return fetchJson<{ data: unknown }, MyAttendanceItem[]>(
    `/api/v1/hrms/me/attendance?limit=${limit}`,
    [] as MyAttendanceItem[],
    {
      revalidateSeconds: 30,
      telemetryKey: "hr.me.attendance",
      mapResponse: (raw) => {
        if (!raw || !Array.isArray(raw.data)) return [];
        return raw.data as MyAttendanceItem[];
      },
    },
  );
}

export type MyLeaveApplicationItem = {
  id: string; leaveTypeId: string; fromDate: string; toDate: string; days: number; status: string;
};

/**
 * Self-service "my own leave applications" — same scoping as
 * getMyLeaveBalance above. Status can be "routing_failed" (see
 * hrms-service leave/domain.ts) when the request's workflow instance was
 * never actually routed to anyone for approval; callers that render this
 * should surface that honestly rather than folding it into "pending".
 */
export async function getMyLeaveApplications(): Promise<LoaderResult<MyLeaveApplicationItem[]>> {
  return fetchJson<{ data: unknown }, MyLeaveApplicationItem[]>(
    "/api/v1/hrms/me/leave-applications",
    [] as MyLeaveApplicationItem[],
    {
      revalidateSeconds: 30,
      telemetryKey: "hr.me.leave_applications",
      mapResponse: (raw) => {
        if (!raw || !Array.isArray(raw.data)) return [];
        return raw.data as MyLeaveApplicationItem[];
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

// GAP-CONTRACTS-LIST-01 / GAP-CONTRACTS-NEW-01: contract-service stores only a
// raw vendorId (uuid) on a contract — it has no joined vendor display name.
// The procurement vendor master DOES carry both id and name, so resolve names
// web-side (cross-service read over HTTP, never a cross-DB join). This loader
// returns id→name pairs the register and the new-contract picker both consume;
// mapVendorSummaries intentionally drops the id (display-only shape), so this
// uses its own id-preserving mapper. A failure is non-fatal to the caller:
// the list falls back to a short id / "Unknown vendor", never a crash.
export interface VendorOption {
  id: string;
  name: string;
}

export function mapVendorOptions(payload: unknown): VendorOption[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: VendorOption[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const name = toText(row.name);
    if (!id || !name) continue;
    mapped.push({ id, name });
  }
  return mapped;
}

export async function getVendorOptions(): Promise<LoaderResult<VendorOption[]>> {
  return fetchJson<unknown, VendorOption[]>("/api/v1/procurement/vendors?limit=500", [], {
    revalidateSeconds: 30,
    telemetryKey: "procurement.vendor_options",
    mapResponse: mapVendorOptions,
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
    // limit=500 is the route maximum; the default of 50 silently truncated the
    // posting dropdowns (GAP-FINANCE-JOURNAL-ENTRY-01: codes must come from the full chart).
    "/api/v1/finance/accounts?limit=500",
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
    const expectedValueMinorRaw = toText(row.expectedValueMinor);
    const expectedValueDisplay = expectedValueMinorRaw ? formatMoney(expectedValueMinorRaw) : undefined;
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
  /**
   * GAP-CRM-ACCOUNTS-DETAIL-06: exact owning-account filter. The account detail
   * page's "View contacts" links by this id (not a free-text name search) so a
   * renamed account keeps its contacts and similarly-named orgs don't mix.
   */
  accountId?: string;
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
  if (opts?.accountId) qs.set("accountId", opts.accountId);
  const path = qs.toString() ? `/api/v1/crm/contacts?${qs}` : "/api/v1/crm/contacts";
  return fetchJson(path, [] as CRMContactSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.contacts",
    responseSchema: crmContactsListSchema,
    mapResponse: mapCrmContacts,
  });
}

/**
 * GAP-CRM-ACCOUNTS-02: the accounts list endpoint is page-capped (crm-service
 * listContactsQuery: default 50, max 200) and returns no total, so stats
 * derived from the returned page can silently undercount. Request the server's
 * maximum page and report whether the page was filled (truncated) so the UI
 * can say "showing the first N" instead of presenting a page count as the
 * whole-master total. A real total needs a backend aggregate (tracked as a
 * backend follow-up); until then this fails safe by never claiming a count it
 * cannot stand behind.
 */
export const CRM_ACCOUNTS_PAGE_LIMIT = 200;

export type CrmAccountsResult = LoaderResult<CRMAccountSummary[]> & {
  /**
   * True when the returned page was full, i.e. more accounts may exist beyond
   * it. Optional only so pre-existing test mocks that stub `{data, source}`
   * keep type-checking; the real loader always sets it.
   */
  truncated?: boolean;
  /** The page size requested (so the UI can word the hint). */
  pageLimit?: number;
  /**
   * GAP-CRM-ACCOUNTS-02: tenant-wide active-account total from the server's
   * `meta.total`, so the page shows "Showing N of M" instead of guessing. Null
   * when the backend did not return it (older contract) or the load failed.
   */
  total?: number | null;
};

export async function getCrmAccounts(): Promise<CrmAccountsResult> {
  // The server now returns `meta.total` alongside the capped page. mapResponse
  // receives the full validated payload, so capture the total here before the
  // mapper reduces it to the row array.
  let total: number | null = null;
  const result = await fetchJson(`/api/v1/crm/accounts?limit=${CRM_ACCOUNTS_PAGE_LIMIT}`, [] as CRMAccountSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.accounts",
    responseSchema: crmAccountsListSchema,
    mapResponse: (payload) => {
      if (payload && typeof payload === "object" && "meta" in payload) {
        const meta = (payload as { meta?: { total?: number } }).meta;
        if (meta && typeof meta.total === "number") total = meta.total;
      }
      return mapCrmAccounts(payload);
    },
  });
  return {
    ...result,
    pageLimit: CRM_ACCOUNTS_PAGE_LIMIT,
    total: result.source === "api" ? total : null,
    // Prefer the authoritative server total when present; else fall back to the
    // "page is full" heuristic the HIGH/wave-1 pass used.
    truncated:
      result.source === "api" &&
      (total !== null ? total > result.data.length : result.data.length >= CRM_ACCOUNTS_PAGE_LIMIT),
  };
}

/**
 * Resolve a single account by id for the detail page (GAP-CRM-ACCOUNTS-DETAIL-01).
 *
 * crm-service has no GET /v1/crm/accounts/:id yet (the by-id endpoint is tracked
 * under GAP-CRM-ACCOUNTS-DETAIL-03), only a capped list. The detail page used to
 * resolve the account with accounts.find() over the DEFAULT list page (50 rows),
 * so a valid deep link to any account beyond the first page rendered
 * "Account not found". This loader queries the list at the server's maximum page
 * size (limit=200) so accounts beyond the default page resolve. The account's
 * EXISTENCE is confirmed authoritatively by the /ancestors endpoint (which loads
 * every tenant account and 404s on an unknown id), so the page can tell "beyond
 * the max page" apart from "truly does not exist". Returns the summary when it is
 * within the max page, else null (caller falls back to existence via ancestors).
 */
export async function getCrmAccount(id: string): Promise<LoaderResult<CRMAccountSummary | null>> {
  const result = await fetchJson("/api/v1/crm/accounts?limit=200", [] as CRMAccountSummary[], {
    revalidateSeconds: 30,
    telemetryKey: "crm.account_lookup",
    responseSchema: crmAccountsListSchema,
    mapResponse: mapCrmAccounts,
  });
  return { ...result, data: result.data.find((a) => a.id === id) ?? null };
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
): Promise<LoaderResult<{ rows: CrmServiceRequestRow[]; total: number; statusCounts: Record<string, number> }>> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.priority) qs.set("priority", params.priority);
  if (params.serviceType) qs.set("serviceType", params.serviceType);
  if (params.search) qs.set("search", params.search);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("page", String(params.page ?? 1));
  return fetchJson<unknown, { rows: CrmServiceRequestRow[]; total: number; statusCounts: Record<string, number> }>(
    `/api/v1/crm/service-requests?${qs.toString()}`,
    { rows: [], total: 0, statusCounts: {} },
    {
      revalidateSeconds: 30,
      telemetryKey: "crm.service-requests",
      mapResponse: (p) => {
        const base = mapEnvelopeWithTotal<CrmServiceRequestRow>(p, (r) => ({
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
        }));
        if (!base) return null;
        // GAP-CRM-SERVICE-REQUESTS-05: per-status totals from the server, used
        // to drive summary tiles that sum to the register total (never a single
        // page's counts). Absent/legacy responses yield an empty map.
        const meta = isRecord(p) && isRecord(p.meta) ? p.meta : undefined;
        const rawCounts = meta && isRecord(meta.statusCounts) ? meta.statusCounts : undefined;
        const statusCounts: Record<string, number> = {};
        if (rawCounts) {
          for (const [k, v] of Object.entries(rawCounts)) {
            if (typeof v === "number") statusCounts[k] = v;
          }
        }
        return { ...base, statusCounts };
      },
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
  feeAmountMinor: string | null;
  mode: string | null;
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
          feeAmountMinor:
            typeof r.feeAmountMinor === "string"
              ? r.feeAmountMinor
              : typeof r.feeAmountMinor === "number"
                ? String(r.feeAmountMinor)
                : null,
          mode: toText(r.mode),
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
// Generic mapper backing every simple "module list" loader built via
// moduleLoader() below -- currently 16 loaders across legal, billing (x4),
// inventory, telephony, locations, notifications, grants (x2), estab,
// knowledge, workflow, analytics and projects. Exported (not a private
// closure) so it's directly unit testable without mocking fetchJson -- see
// loaders.moduleRows.test.ts.
//
// IMPORTANT: return the mapped array as-is, even when empty. A tenant with
// zero rows for a given module is a normal, successful state (the backend
// replies 200 with an empty list), not a parse failure -- fetchJson treats a
// `null` mapResponse return as source:"error" (invalid_payload), which would
// incorrectly render an error/couldn't-load state instead of the correct
// empty state. This is the exact same regression fixed for contracts in
// mapContractsListRows below (see fixup commit b6bd6740 / PR #813) -- this
// generic mapper had the identical `mapped.length > 0 ? mapped : null` bug,
// which mapContractsListRows had in turn copied from here when it was still
// a bespoke inline closure. Only return null when the payload itself
// couldn't be understood as a row list at all (getArrayPayload returns
// null); that case is a genuine invalid-payload failure, distinct from a
// well-formed empty list.
export function mapModuleRows(payload: unknown): ModuleRowSummary[] | null {
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
  return mapped;
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

// Bespoke mapper (not the generic moduleLoader/mapModuleRows): contract-
// service's row shape has neither a "vendor"/"party" display name (only a raw
// vendorId uuid, with no joined vendor-name enrichment in the backend today)
// nor any "type"/"category"/"code" field the generic mapModuleRows() fallback
// chains expect. moduleLoader() here left "Party / Info" permanently blank
// AND made the "Type" column silently display contractNo (mapModuleRows'
// `meta` fallback chain matches contractNo before running out of options) --
// mislabeling a reference number as a contract "type". This mapper is
// explicit about what's actually available: title as the label, the raw
// vendorId as sublabel (until/unless the backend adds a resolved vendor
// name), and contractNo as meta (surfaced under a "Contract No." column
// header, not "Type", in both ContractsTable and the procurement contracts
// register, which share this same loader).
//
// Exported (not a private closure like mapModuleRows) so it's directly unit
// testable without needing to mock fetchJson -- see loaders.contracts.test.ts.
//
// IMPORTANT: return the mapped array as-is, even when empty. A tenant with
// zero contracts is a normal, successful state (GET /contracts replies
// 200 { data: [], ... }), not a parse failure -- fetchJson treats a `null`
// mapResponse return as source:"error" (invalid_payload), which would show
// an error/couldn't-load state instead of the correct "no contracts yet"
// empty state. Only return null when the payload itself couldn't be
// understood as a row list at all (getArrayPayload returns null).
// GAP-CONTRACTS-LIST-04: a contract list row carries the generic
// ModuleRowSummary fields plus the two contract-specific columns the register
// needs — `expiry` (ISO date) and `valueMinor` (paise as a numeric string).
// Both optional: a backend that omits them (or a tenant row that lacks them)
// renders a dash, never a fabricated value.
export type ContractListRow = ModuleRowSummary & {
  expiry?: string;
  valueMinor?: string;
};

export function mapContractsListRows(payload: unknown): ModuleRowSummary[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: ContractListRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const label = toText(row.title) ?? toText(row.contractNo);
    if (!id || !label) continue;
    const sublabel = toText(row.vendorId);
    const status = toText(row.status);
    const meta = toText(row.contractNo);
    // GAP-CONTRACTS-LIST-04: the detail resource exposes `expiry` (a date
    // string) and `valueMinor` (paise, as a numeric string per the live API).
    // Pass both through additively so the list can render an "Expires" column
    // (with an "expiring soon" pill) and a right-aligned "Value" column, and
    // so the hub summary (GAP-CONTRACTS-HOME-04) can bucket by expiry. When a
    // field is absent the column simply renders a dash — never a fabricated 0.
    const expiry = toText(row.expiry) ?? toText(row.validTo) ?? toText(row.expiryDate);
    const valueMinor = toText(row.valueMinor) ?? toText(row.value);
    mapped.push({
      id,
      label,
      ...(sublabel ? { sublabel } : {}),
      ...(status ? { status } : {}),
      ...(meta ? { meta } : {}),
      ...(expiry ? { expiry } : {}),
      ...(valueMinor ? { valueMinor } : {}),
    });
  }
  return mapped;
}

export async function getContracts(): Promise<LoaderResult<ContractListRow[]>> {
  return fetchJson<unknown, ContractListRow[]>("/api/v1/contract/contracts", [], {
    revalidateSeconds: 30,
    telemetryKey: "contract.list",
    mapResponse: mapContractsListRows as (payload: unknown) => ContractListRow[] | null,
  });
}

// GAP-CONTRACTS-HOME-04: a buckets summary for the Contracts hub, computed
// from the same list the register renders — so the hub's "Expiring in 30
// days: N" can never silently disagree with the list. Pure and exported so
// it is unit-testable without mocking fetchJson. Buckets are cumulative
// windows measured from `today` (an injectable ISO date for deterministic
// tests): `in30 <= in60 <= in90`. `expired` counts rows whose expiry is
// strictly before today AND whose status is not already a closed/terminated
// state (an expired-but-closed contract is not an outstanding risk). Returns
// null only when the payload is not a recognizable row list at all, so the
// hub can show dashes (not zeros) on a genuine load failure.
export interface ContractExpirySummary {
  in30: number;
  in60: number;
  in90: number;
  expired: number;
}

export function computeContractExpirySummary(
  rows: ContractListRow[],
  today: string = new Date().toISOString().slice(0, 10),
): ContractExpirySummary {
  const summary: ContractExpirySummary = { in30: 0, in60: 0, in90: 0, expired: 0 };
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  for (const row of rows) {
    if (!row.expiry) continue;
    const expMs = Date.parse(`${row.expiry}T00:00:00Z`);
    if (Number.isNaN(expMs)) continue;
    const status = (row.status ?? "").toLowerCase();
    const days = Math.floor((expMs - todayMs) / 86_400_000);
    if (days < 0) {
      const closed = status === "closed" || status === "terminated" || status === "cancelled";
      if (!closed) summary.expired += 1;
      continue;
    }
    if (days <= 30) summary.in30 += 1;
    if (days <= 60) summary.in60 += 1;
    if (days <= 90) summary.in90 += 1;
  }
  return summary;
}

export async function getContractExpirySummary(): Promise<LoaderResult<ContractExpirySummary | null>> {
  const result = await getContracts();
  if (result.source === "error") {
    return { data: null, source: "error", ...(result.status != null ? { status: result.status } : {}) };
  }
  return { data: computeContractExpirySummary(result.data), source: "api" };
}

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
// GAP-ANALYTICS-LIST-01: the generic moduleLoader-based getAnalyticsDashboards
// was only used by the duplicate /analytics/list route, which now redirects to
// /analytics/dashboards (that page uses the richer typed loader in
// analytics/_data.ts). Export removed to leave one canonical loader.

// Finance loaders

function mapFinanceDashboard(payload: unknown): FinanceDashboard | null {
  if (!isRecord(payload)) return null;
  return {
    // Preserve null (no sanctioned budget on record, UX-006) distinctly from
    // a malformed/missing field defaulting to 0 — collapsing both to 0 would
    // reintroduce the fabricated-0.0%-utilisation bug this type change fixes.
    budgetUtilisationPct:
      typeof payload.budgetUtilisationPct === "number" ? payload.budgetUtilisationPct : null,
    pendingSanctions: typeof payload.pendingSanctions === "number" ? payload.pendingSanctions : 0,
    paymentsThisMonth: typeof payload.paymentsThisMonth === "number" ? payload.paymentsThisMonth : 0,
    totalExpenditure: typeof payload.totalExpenditure === "number" ? payload.totalExpenditure : 0,
    ...(typeof payload.sanctionedMinor === "string" && /^\d+$/.test(payload.sanctionedMinor)
      ? { sanctionedMinor: payload.sanctionedMinor }
      : {}),
  };
}

const FINANCE_DASHBOARD_EMPTY: FinanceDashboard = {
  // null, not 0: an unreachable API is missing data, not a real 0% utilisation (UX-006).
  budgetUtilisationPct: null,
  pendingSanctions: 0,
  paymentsThisMonth: 0,
  totalExpenditure: 0,
};

export async function getFinanceDashboard(fy?: string): Promise<LoaderResult<FinanceDashboard>> {
  // GAP-FINANCE-DASHBOARD-02: finance-service scopes the figures to ?fy=.
  const qs = fy ? `?fy=${encodeURIComponent(fy)}` : "";
  return fetchJson<unknown, FinanceDashboard>(`/api/v1/finance/dashboard${qs}`, FINANCE_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "finance.dashboard",
    responseSchema: FinanceDashboardSchema,
    mapResponse: mapFinanceDashboard,
  });
}

/**
 * GAP-FINANCE-BUDGET-ALLOCATION-03: the budget (BE/RE) rows a re-appropriation moves money between. These are
 * finance_budgets ids -- NOT allocation ids -- which is what POST /v1/finance/reappropriations/:id/submit-approval
 * takes. The wide limit keeps the picker from silently truncating at the endpoint's default page size.
 */
export async function getFinanceBudgetsForReappropriation(): Promise<LoaderResult<BudgetSummary[]>> {
  return fetchJson<unknown, BudgetSummary[]>("/api/v1/finance/budgets?limit=500", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.budgets.reappropriation",
    responseSchema: BudgetSummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as BudgetSummary[] | null,
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
  return fetchJson<unknown, GLEntrySummary[]>(`/api/v1/finance/journals?limit=${GL_JOURNAL_LIMIT}`, [], {
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

export type CashBookQuery = { type?: "cash" | "bank"; from?: string; to?: string };

export async function getFinanceCashBook(query: CashBookQuery = {}): Promise<LoaderResult<CashBookEntry[]>> {
  // GAP-FINANCE-TREASURY-CASH-BANK-01: finance-service's cash-book route takes
  // type (cash|bank) and from/to (YYYY-MM-DD). Values are validated by the page
  // and encoded here; only the params that were chosen are sent.
  const qs = new URLSearchParams();
  if (query.type) qs.set("type", query.type);
  if (query.from) qs.set("from", query.from);
  if (query.to) qs.set("to", query.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchJson<unknown, CashBookEntry[]>(`/api/v1/finance/cash-book${suffix}`, [], {
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
  // No data-cache: a cancel / re-present / mark-stale must show on the next refresh, not 30s later.
  return fetchJson<unknown, FinanceInstrumentSummary | null>(`/api/v1/finance/instruments/${id}`, null, {
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
  // No data-cache: approve / reject / bank-change decisions must show on the next refresh.
  return fetchJson<unknown, FinanceVendorDetail | null>(`/api/v1/finance/vendors/${id}`, null, {
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
export interface FinanceDdoOption { id: string; ddoCode: string; name: string }
export interface FinanceHeadOption { id: string; code: string; name: string }

function mapOptionRows<T>(payload: unknown, pick: (row: Record<string, unknown>) => T | null): T[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const out: T[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const mapped = pick(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** DDO pick-list for the New Bill / New Payment forms (GET /v1/finance/ddo). */
export async function getFinanceDdos(): Promise<LoaderResult<FinanceDdoOption[]>> {
  return fetchJson<unknown, FinanceDdoOption[]>("/api/v1/finance/ddo", [], {
    revalidateSeconds: 300,
    telemetryKey: "finance.ddo",
    mapResponse: (p) =>
      mapOptionRows(p, (r) => {
        const id = toText(r.id);
        const ddoCode = toText(r.ddoCode);
        const name = toText(r.name);
        return id && ddoCode && name && r.isActive !== false ? { id, ddoCode, name } : null;
      }),
  });
}

/** Account-head pick-list (id is the headId createBillBody needs; the generic chart-of-accounts loader drops it). */
export async function getFinanceBillHeads(): Promise<LoaderResult<FinanceHeadOption[]>> {
  return fetchJson<unknown, FinanceHeadOption[]>("/api/v1/finance/accounts", [], {
    revalidateSeconds: 60,
    telemetryKey: "finance.bill_heads",
    mapResponse: (p) =>
      mapOptionRows(p, (r) => {
        const id = toText(r.id);
        const code = toText(r.code);
        const name = toText(r.name);
        return id && code && name ? { id, code, name } : null;
      }),
  });
}

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
  // No data-cache: a recorded reply / escalation / settlement must show on the next refresh.
  return fetchJson<unknown, FinanceAuditParaSummary | null>(`/api/v1/finance/audit-paras/${id}`, null, {
    telemetryKey: "finance.audit-para.detail",
    responseSchema: FinanceAuditParaSummarySchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceAuditParaSummary) : null),
  });
}

/** GAP-FINANCE-AUDIT-PARAS-DETAIL-04: the reply / escalate / settle trail of one audit para. */
export async function getFinanceAuditParaEvents(id: string): Promise<LoaderResult<AuditParaEvent[]>> {
  return fetchJson<unknown, AuditParaEvent[]>(`/api/v1/finance/audit-paras/${pathSeg(id)}/events`, [], {
    telemetryKey: "finance.audit-para.events",
    mapResponse: (p) => (isRecord(p) && Array.isArray(p.data) ? (p.data as AuditParaEvent[]) : null),
  });
}

/** GAP-FINANCE-PAYMENTS-DETAIL-04: beneficiary, linked bill, approver and status history of one payment. */
export async function getFinancePaymentContext(id: string): Promise<LoaderResult<PaymentContext | null>> {
  return fetchJson<unknown, PaymentContext | null>(`/api/v1/finance/payments/${pathSeg(id)}/context`, null, {
    telemetryKey: "finance.payment.context",
    mapResponse: (p) => {
      if (!isRecord(p) || !Array.isArray(p.events)) return null;
      return p as unknown as PaymentContext;
    },
  });
}

/**
 * Actor id -> display name, for the finance detail pages. Fail-open by design: a lookup failure yields
 * an empty map and the page shows "User 1a2b3c4d" instead of breaking (a display enrichment only).
 */
export async function getFinanceActorNames(ids: readonly (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(i)))].slice(0, 50);
  if (unique.length === 0) return {};
  const res = await fetchJson<unknown, Record<string, string>>(`/api/v1/finance/actors?ids=${unique.join(",")}`, {}, {
    revalidateSeconds: 60,
    telemetryKey: "finance.actors",
    mapResponse: (p) => {
      if (!isRecord(p) || !Array.isArray(p.data)) return null;
      const out: Record<string, string> = {};
      for (const r of p.data as Array<{ id?: unknown; name?: unknown }>) {
        if (typeof r.id === "string" && typeof r.name === "string") out[r.id] = r.name;
      }
      return out;
    },
  });
  return res.data;
}

export type GlPageParams = { fy?: string | undefined; type?: string | undefined; q?: string | undefined; page: number; pageSize: number };
export type GlPageData = { entries: GLEntrySummary[]; pagination: GlLinesPagination; totals: GlLinesTotals | null };

/** GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: one server-filtered page of ledger lines with whole-set totals. */
export async function getFinanceGLPage(p: GlPageParams): Promise<LoaderResult<GlPageData>> {
  const qs = new URLSearchParams({ limit: String(p.pageSize), offset: String((Math.max(1, p.page) - 1) * p.pageSize) });
  if (p.fy) qs.set("fy", p.fy);
  if (p.type) qs.set("type", p.type);
  if (p.q) qs.set("q", p.q);
  const empty: GlPageData = { entries: [], pagination: { limit: p.pageSize, offset: 0, total: 0, hasMore: false }, totals: null };
  return fetchJson<unknown, GlPageData>(`/api/v1/finance/journals/lines?${qs.toString()}`, empty, {
    telemetryKey: "finance.gl.page",
    mapResponse: (raw) => {
      if (!isRecord(raw) || !Array.isArray(raw.data) || !isRecord(raw.pagination)) return null;
      const parsed = GLEntrySummaryListSchema.safeParse(raw.data);
      if (!parsed.success) return null;
      return {
        entries: parsed.data as GLEntrySummary[],
        pagination: raw.pagination as unknown as GlLinesPagination,
        totals: isRecord(raw.totals) ? (raw.totals as unknown as GlLinesTotals) : null,
      };
    },
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

/** GAP-FINANCE-DEBT-01: one loan with its EMI schedule (null when the id is unknown). */
export async function getFinanceDebtById(id: string): Promise<LoaderResult<FinanceDebtDetail | null>> {
  return fetchJson<unknown, FinanceDebtDetail | null>(`/api/v1/finance/debt/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "finance.debt.detail",
    responseSchema: FinanceDebtDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceDebtDetail) : null),
  });
}

/**
 * fp-finance-01: maker-checker change requests awaiting a second officer
 * (fiscal-year activation, opening balances, HoA-code change). `kind` narrows to one.
 */
export async function getFinancePendingChangeRequests(
  kind?: FinanceChangeRequest["kind"],
): Promise<LoaderResult<FinanceChangeRequest[]>> {
  const qs = `status=pending&limit=100${kind ? `&kind=${kind}` : ""}`;
  return fetchJson<unknown, FinanceChangeRequest[]>(`/api/v1/finance/change-requests?${qs}`, [], {
    revalidateSeconds: 0,
    telemetryKey: "finance.change-requests",
    responseSchema: FinanceChangeRequestListSchema,
    mapResponse: (p) => getArrayPayload(p) as FinanceChangeRequest[] | null,
  });
}

/** fp-finance-01: per-tenant finance policy switches (second approver, FY activation rules). */
export async function getFinanceSettings(): Promise<LoaderResult<FinanceSettings | null>> {
  return fetchJson<unknown, FinanceSettings | null>("/api/v1/finance/settings", null, {
    revalidateSeconds: 0,
    telemetryKey: "finance.settings",
    responseSchema: FinanceSettingsSchema,
    mapResponse: (p) => (isRecord(p) ? (p as FinanceSettings) : null),
  });
}

/**
 * GAP-FINANCE-CONFIG-05: one fiscal-year loader for /finance/fiscal-years and
 * /finance/config, so the two screens cannot diverge on payload shape (array
 * or `{data}`) or on defaulting of missing fields.
 */
export type FinanceFiscalYear = {
  id?: string;
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
};

function isRecordValue(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function rowsOfPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecordValue(payload) && Array.isArray(payload.data)) return payload.data;
  return null;
}

export function mapFiscalYears(payload: unknown): FinanceFiscalYear[] | null {
  const rows = rowsOfPayload(payload);
  if (!rows) return null;
  const mapped: FinanceFiscalYear[] = [];
  for (const raw of rows) {
    if (!isRecordValue(raw)) continue;
    if (typeof raw.code !== "string" || typeof raw.label !== "string") continue;
    mapped.push({
      ...(typeof raw.id === "string" ? { id: raw.id } : {}),
      code: raw.code,
      label: raw.label,
      startDate: typeof raw.startDate === "string" ? raw.startDate : "",
      endDate: typeof raw.endDate === "string" ? raw.endDate : "",
      status: typeof raw.status === "string" ? raw.status : "unknown",
    });
  }
  return mapped;
}

export async function getFinanceFiscalYears(): Promise<LoaderResult<FinanceFiscalYear[]>> {
  return fetchJson<unknown, FinanceFiscalYear[]>("/api/v1/finance/fiscal-years", [], {
    telemetryKey: "finance.fiscal_years",
    mapResponse: mapFiscalYears,
  });
}

/**
 * GET /v1/finance/bank-accounts never returns the full number: it sends
 * `accountNoLast4` and a masked `ifscPrefix` (masters/bank-routes.ts).
 */
export type FinanceBankAccount = {
  id: string;
  bankName: string;
  branchName: string | null;
  accountNoLast4: string;
  ifscPrefix: string;
  accountType: string;
  purpose: string | null;
  status: string;
};

export function mapBankAccounts(payload: unknown): FinanceBankAccount[] | null {
  const rows = rowsOfPayload(payload);
  if (!rows) return null;
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const mapped: FinanceBankAccount[] = [];
  for (const raw of rows) {
    if (!isRecordValue(raw)) continue;
    if (typeof raw.id !== "string" || typeof raw.bankName !== "string") continue;
    mapped.push({
      id: raw.id,
      bankName: raw.bankName,
      branchName: typeof raw.branchName === "string" ? raw.branchName : null,
      accountNoLast4: str(raw.accountNoLast4),
      ifscPrefix: str(raw.ifscPrefix),
      accountType: str(raw.accountType),
      purpose: typeof raw.purpose === "string" ? raw.purpose : null,
      status: str(raw.status, "unknown"),
    });
  }
  return mapped;
}

export async function getFinanceBankAccounts(): Promise<LoaderResult<FinanceBankAccount[]>> {
  return fetchJson<unknown, FinanceBankAccount[]>("/api/v1/finance/bank-accounts", [], {
    telemetryKey: "finance.bank_accounts",
    mapResponse: mapBankAccounts,
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
  employeeTypeBreakdown: [],
  routingFailedCount: 0,
  scope: "organisation",
  totalDepartments: 0,
  servingCount: null,
};

function mapHRDashboard(payload: unknown): HRDashboard | null {
  if (!isRecord(payload)) return null;
  const raw = payload as Record<string, unknown>;
  return {
    headcount: typeof raw.headcount === "number" ? raw.headcount : 0,
    headcountLastMonth: typeof raw.headcountLastMonth === "number" ? raw.headcountLastMonth : 0,
    // GAP-HR-DASHBOARD-07: a genuine `null` from the backend (no attendance
    // feed synced for today) must pass through as null, not get coerced to a
    // fabricated 0 here -- same bug class the backend fix just closed, one
    // layer up. Only a truly missing/non-number/non-null field falls back to 0.
    attendanceTodayPct:
      typeof raw.attendanceTodayPct === "number"
        ? raw.attendanceTodayPct
        : raw.attendanceTodayPct === null
        ? null
        : 0,
    pendingLeaves: typeof raw.pendingLeaves === "number" ? raw.pendingLeaves : 0,
    onLeave: typeof raw.onLeave === "number" ? raw.onLeave : 0,
    payrollDue: typeof raw.payrollDue === "number" ? raw.payrollDue : 0,
    departmentBreakdown: Array.isArray(raw.departmentBreakdown)
      ? (raw.departmentBreakdown as { name: string; count: number }[])
      : [],
    employeeTypeBreakdown: Array.isArray(raw.employeeTypeBreakdown)
      ? (raw.employeeTypeBreakdown as { name: string; count: number }[])
      : [],
    routingFailedCount: typeof raw.routingFailedCount === "number" ? raw.routingFailedCount : 0,
    scope: raw.scope === "direct_reports" ? "direct_reports" : "organisation",
    totalDepartments: typeof raw.totalDepartments === "number" ? raw.totalDepartments : 0,
    servingCount: typeof raw.servingCount === "number" ? raw.servingCount : null,
  };
}

/**
 * GAP-HR-DASHBOARD-02: previously returned the bare `{data, routingFailed}`
 * tuple with a try/catch that swallowed fetchJson's own `source` (fetchJson
 * itself never throws -- see apiClient.ts's fetchJson, which always resolves
 * to a LoaderResult -- so this catch could never fire on a real failure path
 * and only masked the information loss). Any failure of
 * /dashboard/pending-leaves silently produced {data:[],routingFailed:[]},
 * which page.tsx and ActionInbox.tsx could not distinguish from a genuinely
 * empty, healthy inbox -- rendering the false "Inbox clear" empty state
 * instead of an honest error. Now returns the full LoaderResult so callers
 * can key off `source` exactly like every other loader in this file.
 */
export async function getDashboardLeaveInbox(): Promise<LoaderResult<{ data: LeaveInboxItem[]; routingFailed: LeaveInboxItem[] }>> {
  return fetchJson<unknown, { data: LeaveInboxItem[]; routingFailed: LeaveInboxItem[] }>(
    "/api/v1/hrms/dashboard/pending-leaves",
    { data: [] as LeaveInboxItem[], routingFailed: [] as LeaveInboxItem[] },
    {
      revalidateSeconds: 30,
      telemetryKey: "hr.dashboard.pending_leaves",
      mapResponse: (p) => {
        // A malformed payload is a genuine invalid-payload failure (mirrors
        // mapEmployees'/mapHRDashboard's null-on-unparseable convention) --
        // NOT the same as "well-formed, zero pending items", which must
        // still resolve to source:"api" with empty arrays.
        if (!isRecord(p) || !Array.isArray(p.data)) return null;
        return {
          data: p.data as LeaveInboxItem[],
          routingFailed: Array.isArray(p.routingFailed) ? (p.routingFailed as LeaveInboxItem[]) : [],
        };
      },
    }
  );
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

export async function getPayrollRunDetails(
  opts: { limit?: number; month?: string } = {}
): Promise<LoaderResult<PayrollRunDetail[]>> {
  // fix/high-data-issues: opts are optional and additive -- a bare
  // getPayrollRunDetails() call (payroll/page.tsx, payroll/period/page.tsx,
  // payroll/runs/page.tsx) still hits the exact same "/api/v1/payroll/runs"
  // URL as before. Callers that know the specific period they need (the run
  // detail page's MoM comparison) can now ask for just that row instead of
  // fetching the backend's whole default batch and filtering client-side.
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.month) params.set("month", opts.month);
  const qs = params.toString();
  return fetchJson<unknown, PayrollRunDetail[]>(`/api/v1/payroll/runs${qs ? `?${qs}` : ""}`, [], {
    telemetryKey: "hr.payroll.runs.detail",
    responseSchema: PayrollRunDetailListSchema,
    mapResponse: (p) => getArrayPayload(p) as PayrollRunDetail[] | null,
  });
}

export async function getPayrollRunById(id: string): Promise<LoaderResult<PayrollRunFullDetail | null>> {
  return fetchJson<unknown, PayrollRunFullDetail | null>(`/api/v1/payroll/runs/${id}`, null, {
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

/**
 * GAP-PAYROLL-SALARY-SLIPS-04: the signed-in employee's OWN slips
 * (GET /v1/payroll/slips/mine). The server resolves the employee from the
 * session token; nothing here (or in the URL) names an employee.
 */
export async function getMySlips(limit = 24, offset = 0): Promise<LoaderResult<SalarySlipSummary[]>> {
  return fetchJson<unknown, SalarySlipSummary[]>(`/api/v1/payroll/slips/mine?limit=${limit}&offset=${offset}`, [], {
    telemetryKey: "hr.my-slips",
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
  // GAP-HR-TRAINING-NEW-01: was revalidateSeconds: 300 -- a newly-created
  // programme could stay invisible on /hr/training for up to 5 minutes
  // after the create actually committed, since apiClient maps
  // revalidateSeconds straight onto Next's own fetch({next:{revalidate}})
  // data cache (a time-based cache, not one `router.refresh()` alone can
  // bust early). Paired with training/consumer.ts's new
  // cache.invalidateResource call (the separate, hrms-service-side list
  // cache), this list is now always fetched fresh; the training-programs
  // endpoint is a low-traffic HR-admin list, so the caching trade-off this
  // gives up is small next to the correctness bug it was causing.
  return fetchJson<unknown, TrainingProgramSummary[]>("/api/v1/hrms/training-programs", [], {
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
  /** GAP-PROCUREMENT-BID-EVALUATION-05: opaque tender id for linking the ref. */
  tenderId?: string;
  bidder: string;
  technicalScore: number;
  /**
   * GAP-PROCUREMENT-BID-EVALUATION-06: null while the financial envelope is
   * sealed (financialOpened=false). The UI renders this as a withheld "—".
   */
  financialScore: number | null;
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
  // GAP-PROCUREMENT-REVERSE-AUCTION-02: stable human identifier + indent ref.
  auctionNo: string;
  indentRef: string;
  item: string;
  startPrice: number;
  currentLowest: number;
  // GAP-PROCUREMENT-REVERSE-AUCTION-03: authoritative paise (string) for exact
  // formatMoney display and BigInt savings maths.
  startPriceMinor: string;
  currentLowestMinor: string;
  savingsMinor: string;
  bidders: number;
  timeRemaining: string;
  // GAP-PROCUREMENT-REVERSE-AUCTION-01: real end instant for the client countdown.
  endsAt: string;
  status: string;
};

export async function getProcurementReverseAuctions(): Promise<LoaderResult<ReverseAuction[]>> {
  return fetchJson<unknown, ReverseAuction[]>("/api/v1/procurement/reverse-auctions", [], {
    revalidateSeconds: 30,
    telemetryKey: "procurement.reverse_auctions",
    mapResponse: (p) => getArrayPayload(p) as ReverseAuction[] | null,
  });
}

/**
 * GAP-PROCUREMENT-REVERSE-AUCTION-02: a single auction for the read-only detail
 * page. Reuses the clean list endpoint (which already returns string minor
 * units + endsAt) and finds the row by id, rather than depending on the raw
 * auction row's bigint serialization.
 */
export async function getProcurementReverseAuctionById(id: string): Promise<LoaderResult<ReverseAuction | null>> {
  const result = await getProcurementReverseAuctions();
  const match = (result.data ?? []).find((a) => a.id === id) ?? null;
  return { ...result, data: match };
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
  // GAP-PROCUREMENT-PRE-BID-01: opaque tender id for linking the tender cell.
  tenderId: string;
  tender: string;
  date: string;
  queriesRaised: number;
  responses: number;
  // GAP-PROCUREMENT-PRE-BID-03: unanswered queries, computed server-side.
  openQueries: number;
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
      // GAP-CRM-DEALS-04: DealSummary.amount is now a minor-unit string. (This
      // mapDeals is currently unused — getDeals uses mapDealSummaries — but keep
      // it type-correct: emit an exact digit string, "0" when absent/invalid.)
      amount: typeof row.amount === "number" && Number.isSafeInteger(row.amount) && row.amount >= 0 ? String(row.amount) : "0",
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

/**
 * GAP-CRM-PIPELINE-05: the Kanban board fetches at most this many engagements.
 * Exported so the page can detect a likely truncation (exactly this many rows
 * came back) and warn the clerk that the board — and the figures derived from
 * it — may be incomplete, rather than silently dropping the 201st engagement.
 */
export const PIPELINE_DEAL_LIMIT = 200;

export type PipelineDealsResult = LoaderResult<PipelineDealCard[]> & {
  /**
   * GAP-CRM-PIPELINE-05: tenant-wide (or pipeline-scoped) live-deal total from the
   * server's `pagination.total`, so the board shows "N of M". Null when the load
   * failed or the backend did not return it.
   */
  total?: number | null;
};

export async function getPipelineDeals(pipelineId?: string): Promise<PipelineDealsResult> {
  let total: number | null = null;
  const qs = new URLSearchParams({ limit: String(PIPELINE_DEAL_LIMIT) });
  if (pipelineId) qs.set("pipelineId", pipelineId);
  const result = await fetchJson<unknown, PipelineDealCard[]>(`/api/v1/crm/deals?${qs.toString()}`, [], {
    revalidateSeconds: 30,
    telemetryKey: "crm.pipeline.deals",
    mapResponse: (payload) => {
      if (payload && typeof payload === "object" && "pagination" in payload) {
        const pg = (payload as { pagination?: { total?: number } }).pagination;
        if (pg && typeof pg.total === "number") total = pg.total;
      }
      return mapPipelineDeals(payload);
    },
  });
  return { ...result, total: result.source === "api" ? total : null };
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

export interface ChatConversationCounts {
  total: number;
  active: number;
  handedOff: number;
  ended: number;
}

/**
 * GAP-AI-CHAT-03: accurate conversation counts for the stat cards, read from
 * the list endpoint's server-side `meta.total` (a COUNT, not the fetched page
 * length) for all conversations and for each status. With more than 100
 * conversations the "Conversations" card previously reported at most 100 and
 * "With agent" could under-count; these counts are exact regardless of how many
 * rows a single page holds. A limit of 1 keeps each count cheap. Returns null
 * on any failure so the page can fall back to "—" rather than a fabricated 0.
 */
export async function getChatConversationCounts(): Promise<LoaderResult<ChatConversationCounts | null>> {
  const countOpts = () => ({
    revalidateSeconds: 0,
    telemetryKey: "ai.chat.conversation_counts",
    responseSchema: chatConversationsCountSchema,
    mapResponse: (payload: { meta: { total: number } }) => payload.meta.total,
  });
  // Full literal paths (no `${base}` interpolation): scripts/contract/screen-map.mjs
  // resolves each fetchJson path statically against the gateway registry and
  // cannot follow a variable, so an interpolated prefix was read as an
  // unresolvable ":param&status=..." route and failed the Screen Verification Gate.
  const [all, active, handed, ended] = await Promise.all([
    fetchJson("/api/v1/ai/chat?limit=1", null as number | null, countOpts()),
    fetchJson("/api/v1/ai/chat?limit=1&status=active", null as number | null, countOpts()),
    fetchJson("/api/v1/ai/chat?limit=1&status=handed_off", null as number | null, countOpts()),
    fetchJson("/api/v1/ai/chat?limit=1&status=ended", null as number | null, countOpts()),
  ]);
  if (
    all.source === "error" || active.source === "error" ||
    handed.source === "error" || ended.source === "error" ||
    all.data === null || active.data === null || handed.data === null || ended.data === null
  ) {
    return { data: null, source: "error" };
  }
  return {
    data: { total: all.data, active: active.data, handedOff: handed.data, ended: ended.data },
    source: "api",
  };
}

/**
 * A single conversation.
 *
 * GAP-AI-CHAT-DETAIL-03: ai-agent-service now exposes GET /v1/ai/chat/:id, so
 * this reads one conversation by id rather than downloading the newest 200 and
 * picking by id (which rendered "not found" for any conversation older than the
 * newest page). A tenant-scoped 404 is mapped to a clean not-found
 * (source "api", data null) so the detail page can tell "this id does not
 * exist / is another tenant's" apart from a service outage (source "error"),
 * which GAP-AI-CHAT-DETAIL-05 relies on.
 */
export async function getChatConversation(id: string): Promise<LoaderResult<ChatConversation | null>> {
  const result = await fetchJson(`/api/v1/ai/chat/${id}`, null as ChatConversation | null, {
    revalidateSeconds: 0,
    telemetryKey: "ai.chat.conversation",
    responseSchema: chatConversationItemSchema,
    mapResponse: (payload) => payload.data,
  });
  // A 404 is a definitive "not found", not an outage: present it as a
  // successful read of an absent conversation so the page shows its
  // not-found state rather than a retry state.
  if (result.source === "error" && result.status === 404) {
    return { data: null, source: "api" };
  }
  return result;
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

/** The page size requested for the copilot turn history (GAP-AI-COPILOT-04). */
export const COPILOT_TURNS_LIMIT = 50;

/**
 * Recent copilot turns for the tenant, newest first, plus the server's total
 * count (GAP-AI-COPILOT-04) so the stat cards can show the real total rather
 * than a figure that silently tops out at the page size. `total` is null when
 * the service did not send `meta.total`.
 */
export async function getCopilotTurns(): Promise<LoaderResult<{ turns: CopilotTurn[]; total: number | null }>> {
  return fetchJson(
    `/api/v1/ai/copilot/turns?limit=${COPILOT_TURNS_LIMIT}`,
    { turns: [] as CopilotTurn[], total: null },
    {
      revalidateSeconds: 0,
      telemetryKey: "ai.copilot.turns",
      responseSchema: copilotTurnsListSchema,
      mapResponse: (payload) => ({
        turns: payload.data.map((turn) => ({
          ...turn,
          sourceCitations: (turn.sourceCitations ?? []).map((citation) => ({
            ...citation,
            id: citation.id ?? "",
          })),
        })),
        total: typeof payload.meta?.total === "number" ? payload.meta.total : null,
      }),
    },
  );
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
 * Weighted revenue forecast for active deals, optionally scoped to one pipeline
 * and/or a close-date window (GAP-CRM-FORECAST-03 — tie the total to a quarter /
 * financial year). The total is recomputed server-side, so these are query
 * parameters rather than a client-side narrowing.
 */
export async function getCrmForecast(
  pipelineId?: string,
  window?: { closeDateFrom?: string; closeDateTo?: string },
): Promise<LoaderResult<CRMForecast>> {
  const params = new URLSearchParams();
  if (pipelineId) params.set("pipelineId", pipelineId);
  if (window?.closeDateFrom) params.set("closeDateFrom", window.closeDateFrom);
  if (window?.closeDateTo) params.set("closeDateTo", window.closeDateTo);
  const qs = params.toString();
  return fetchJson(
    qs ? `/api/v1/crm/forecast?${qs}` : "/api/v1/crm/forecast",
    CRM_FORECAST_EMPTY,
    CRM_FORECAST_OPTIONS,
  );
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

export interface CRMCitizenRatings {
  /** Mean 1-5, or null when there are no ratings (tile shows '—'). */
  average: number | null;
  count: number;
}

/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05: citizen rating aggregate (average +
 * count) for the VoC dashboard's "Citizen ratings" tile, kept SEPARATE from the
 * model-scored sentiment summary. Falls back to a null/0 aggregate on failure so
 * the tile shows '—' rather than a fabricated score.
 */
export async function getCrmCitizenRatings(): Promise<LoaderResult<CRMCitizenRatings>> {
  const empty: CRMCitizenRatings = { average: null, count: 0 };
  return fetchJson("/api/v1/crm/citizen-feedback/summary", empty, {
    revalidateSeconds: 60,
    telemetryKey: "crm.citizen_ratings",
    mapResponse: (payload): CRMCitizenRatings | null => {
      if (!payload || typeof payload !== "object") return null;
      const data = (payload as { data?: { average?: unknown; count?: unknown } }).data;
      if (!data || typeof data !== "object") return null;
      const count = typeof data.count === "number" ? data.count : 0;
      const average = typeof data.average === "number" ? data.average : null;
      return { average, count };
    },
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

export const CAMPAIGN_ROI_SUMMARY_LIMIT = 200;

export async function getCrmCampaignRoiSummary(): Promise<LoaderResult<CRMCampaignRoiSummary>> {
  return fetchJson(
    `/api/v1/crm/campaigns/roi-summary?limit=${CAMPAIGN_ROI_SUMMARY_LIMIT}`,
    { rows: [], total: 0 } as CRMCampaignRoiSummary,
    {
      revalidateSeconds: 60,
      telemetryKey: "crm.campaign.roi_summary",
      responseSchema: crmCampaignRoiSummarySchema,
      // GAP-CRM-CAMPAIGNS-03: carry the service's full distinct-campaign count
      // (meta.total) through so the page can flag partial (first-page) totals.
      // Fall back to the row count when an older service omits meta.total.
      mapResponse: (payload) => ({
        rows: payload.data,
        total: payload.meta?.total ?? payload.data.length,
      }),
    },
  );
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
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      const detail = p as ContactDetail;
      // The backend sends the raw expectedValueMinor but never a precomputed
      // display string; derive it the same way the contacts list does.
      if (!detail.expectedValueDisplay && detail.expectedValueMinor) {
        return { ...detail, expectedValueDisplay: formatMoney(detail.expectedValueMinor) };
      }
      return detail;
    },
  });
}

export function mapCRMActivityEntries(payload: unknown): CRMActivityEntry[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const mapped: CRMActivityEntry[] = [];
  // Must match the backend create/list enum (crm-service activities validators)
  // and CRMActivityEntry['type']. Previously only five of these were accepted,
  // so a saved appointment/reminder/complaint was silently dropped from the
  // list and every stat (GAP-CRM-ACTIVITIES-01).
  const validTypes = new Set(["call", "meeting", "email", "task", "note", "appointment", "reminder", "complaint"]);
  const validStatuses = new Set(["open", "overdue", "completed", "cancelled"]);
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = toText(row.id);
    const rawType = toText(row.type) ?? "task";
    // Keep the row rather than discarding it: an unrecognised type falls back
    // to "note" so a record is never silently lost from the list/counts.
    const type = validTypes.has(rawType) ? rawType : "note";
    const subject = toText(row.subject) ?? toText(row.text);
    const owner = toText(row.owner) ?? toText(row.actorName) ?? toText(row.actor) ?? "—";
    const rawStatus = toText(row.status) ?? "open";
    // GAP-CRM-ACTIVITIES-04: keep the row rather than discarding it. An
    // unrecognised status (e.g. in_progress/done from a newer backend) falls
    // back to "open" so a legitimate record is never silently lost from the
    // list and counts; previously such rows were `continue`d past entirely.
    const status = validStatuses.has(rawStatus) ? rawStatus : "open";
    if (!id || !subject) continue;
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
  // GAP-CRM-ACTIVITIES-04: an empty-but-valid list is NOT an error. Return the
  // (possibly empty) array whenever the payload was a valid array; getArrayPayload
  // already returned null for a non-array, which is the only real failure here.
  // Previously `mapped.length > 0 ? mapped : null` made fetchJson report a
  // legitimately-empty activity register as source:'error' with "—" stats.
  return mapped;
}

// Wire-level guard for GET /v1/crm/activities. The previous schema here
// (CRMActivityEntryListSchema) described the MAPPED CRMActivityEntry shape
// (owner, non-null subject) as a bare array, but crm-service returns the
// `{ data, pagination }` envelope of activityViewSchema rows (actorName / text,
// nullable subject, no owner). Every real response therefore failed validation and
// /crm/activities always rendered "We couldn't load interactions". Validate only
// the envelope here; mapCRMActivityEntries() does the per-row field validation and
// the enum fallbacks.
const crmActivitiesWireSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ data: z.array(z.record(z.string(), z.unknown())) }).passthrough(),
]);

export async function getCRMActivities(): Promise<LoaderResult<CRMActivityEntry[]>> {
  return fetchJson<unknown, CRMActivityEntry[]>("/api/v1/crm/activities", [], {
    revalidateSeconds: 60,
    telemetryKey: "crm.activities.full",
    responseSchema: crmActivitiesWireSchema,
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
  // Same reasoning as mapTickets() above: an empty (but valid) result set is
  // not a mapping failure. getBreachedSLATickets() below relies on this for
  // each of its three per-status fetches — a tenant with e.g. zero due_soon
  // tickets is common and must not flip the whole SLA Queue page to source:"error".
  return mapped;
}

export async function getHelpdeskTicketList(): Promise<LoaderResult<TicketDetail[]>> {
  return fetchJson<unknown, TicketDetail[]>("/api/v1/citizen/tickets", [], {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.tickets.full",
    mapResponse: mapHelpdeskTicketList,
  });
}

export async function getHelpdeskTicketById(id: string): Promise<LoaderResult<TicketDetail | null>> {
  return fetchJson<unknown, TicketDetail | null>(`/api/v1/citizen/tickets/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 30,
    telemetryKey: "helpdesk.ticket.detail",
    mapResponse: mapHelpdeskTicketDetail,
  });
}

/**
 * GAP-HELPDESK-SLAS-02: extends `LoaderResult` with per-bucket error sources
 * so the page can show which SLA bucket failed instead of blanking everything.
 */
export type SlaTicketsResult = LoaderResult<TicketDetail[]> & {
  bucketSources: Record<"breached" | "due_soon" | "within_sla", LoaderSource>;
};

/**
 * Powers /helpdesk/slas (SLA Queue). That page computes its own
 * Breached/Due Soon/Within SLA/Total stat cards by filtering the returned
 * list client-side, then separately re-filters+sorts to "breached" for the
 * table — i.e. it expects the FULL cross-status population, not a
 * pre-filtered slice. citizen-service's list endpoint only returns the rich
 * per-ticket shape (requesterName, createdAt, etc. — via listTicketDetails)
 * when a slaStatus filter is supplied; the unfiltered call returns a much
 * narrower summary instead (see getHelpdeskTicketList's toSummary()
 * counterpart). So fetch all three valid slaStatus buckets and merge, rather
 * than a single filtered or unfiltered call, to get both the rich shape and
 * the full population.
 *
 * NOTE: no `responseSchema` here — citizen-service wraps this branch's
 * response as `{ data, pagination }`, not a bare array (TicketDetailListSchema
 * is `z.array(...)` and would fail to parse the envelope, forcing
 * source:"error" on every call) — mapTicketDetails already unwraps the
 * envelope itself via getArrayPayload().
 */
export async function getBreachedSLATickets(): Promise<SlaTicketsResult> {
  const fetchBucket = (slaStatus: "breached" | "due_soon" | "within_sla") =>
    fetchJson<unknown, TicketDetail[]>(`/api/v1/citizen/tickets?slaStatus=${slaStatus}`, [], {
      revalidateSeconds: 30,
      telemetryKey: `helpdesk.sla.${slaStatus}`,
      mapResponse: mapTicketDetails,
    });

  const [breached, dueSoon, withinSla] = await Promise.all([
    fetchBucket("breached"),
    fetchBucket("due_soon"),
    fetchBucket("within_sla"),
  ]);

  return {
    data: [...breached.data, ...dueSoon.data, ...withinSla.data],
    source: breached.source === "error" || dueSoon.source === "error" || withinSla.source === "error"
      ? "error"
      : "api",
    // GAP-HELPDESK-SLAS-02: expose each bucket's own source so the page can
    // keep rendering the buckets that loaded and surface an error only for the
    // bucket that actually failed, instead of blanking the whole page when any
    // one of the three fetches errors.
    bucketSources: {
      breached: breached.source,
      due_soon: dueSoon.source,
      within_sla: withinSla.source,
    },
  };
}

/** GAP-HELPDESK-SLAS-05: name matches behaviour (returns all SLA buckets, not only breached). */
export const getSlaTickets = getBreachedSLATickets;

const TICKET_ANALYTICS_EMPTY: TicketAnalytics = {
  totalTickets: 0,
  openTickets: 0,
  resolvedThisMonth: 0,
  slaBreachedCount: 0,
  avgResolutionHours: 0,
  byPriority: [],
  byChannel: [],
};

export async function getTicketAnalytics(period?: "mtd" | "qtd" | "fy"): Promise<LoaderResult<TicketAnalytics>> {
  // GAP-HELPDESK-REPORTS-01: pass the selected reporting period to the backend
  // so the request carries the range. (The citizen-service analytics endpoint
  // accepts `period` as an optional query param; see helpdesk/routes.ts.)
  const query = period ? `?period=${period}` : "";
  return fetchJson<unknown, TicketAnalytics>(`/api/v1/citizen/tickets/analytics${query}`, TICKET_ANALYTICS_EMPTY, {
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
    // GAP-CITIZEN-RTI-02: do not serve a stale list after a §6(3) transfer.
    // The RTI register is a statutory, mutation-heavy view; a router.refresh()
    // after a transfer must re-read fresh data, so the fetch is not cached.
    revalidateSeconds: 0,
    telemetryKey: "citizen.rti",
    responseSchema: RTISummaryListSchema,
    mapResponse: (p) => getArrayPayload(p) as RTISummary[] | null,
  });
}

// Citizen — Portal, Alerts, Notices, Surveys

// The route (citizen-service requests/routes.ts, GET /v1/citizen/portal/metrics)
// returns a single real-metrics object -- { data: { totalServices, activeRequests,
// resolvedThisMonth, avgResolutionDays } } -- not a row list. COMP-010: this loader
// used to route the payload through getArrayPayload() expecting an array of
// per-metric rows, which never matched this object and always fell back to
// source:"error" with empty data. Parse the real object shape directly instead.
export type CitizenPortalMetrics = {
  totalServices: number;
  activeRequests: number;
  resolvedThisMonth: number;
  avgResolutionDays: number;
};

const CITIZEN_PORTAL_METRICS_EMPTY: CitizenPortalMetrics = {
  totalServices: 0,
  activeRequests: 0,
  resolvedThisMonth: 0,
  avgResolutionDays: 0,
};

export function mapCitizenPortalMetrics(payload: unknown): CitizenPortalMetrics | null {
  const data = isRecord(payload) ? payload.data : null;
  if (
    !isRecord(data) ||
    typeof data.totalServices !== "number" ||
    typeof data.activeRequests !== "number" ||
    typeof data.resolvedThisMonth !== "number" ||
    typeof data.avgResolutionDays !== "number"
  ) {
    return null;
  }
  return {
    totalServices: data.totalServices,
    activeRequests: data.activeRequests,
    resolvedThisMonth: data.resolvedThisMonth,
    avgResolutionDays: data.avgResolutionDays,
  };
}

export async function getCitizenPortal(): Promise<LoaderResult<CitizenPortalMetrics>> {
  return fetchJson<unknown, CitizenPortalMetrics>("/api/v1/citizen/portal/metrics", CITIZEN_PORTAL_METRICS_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "citizen.portal",
    mapResponse: mapCitizenPortalMetrics,
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

import type { CitizenSurvey } from "@/lib/citizenSurveys";
export type { CitizenSurvey, SurveySummary } from "@/lib/citizenSurveys";
export { normalizeSurveyStatus, parseCompletionPct, summarizeSurveys } from "@/lib/citizenSurveys";

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

// COMP-016: projects/schemes/[id] used to render an 11-entry hardcoded
// SCHEMES catalogue instead of calling any loader at all. This is the real
// per-id counterpart to getSchemes() above, against the same already-real
// GET /v1/projects/schemes/:id route.
export async function getSchemeDetail(id: string): Promise<LoaderResult<SchemeDetail | null>> {
  return fetchJson<unknown, SchemeDetail | null>(`/api/v1/project/schemes/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "projects.scheme-detail",
    responseSchema: SchemeDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as SchemeDetail) : null),
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

// GAP-GRANTS-GRANTEES-04: single-grantee read for the grantee detail route.
export async function getGranteeById(id: string): Promise<LoaderResult<GranteeDetail | null>> {
  return fetchJson<unknown, GranteeDetail | null>(`/api/v1/grants/grantees/${id}`, null, {
    revalidateSeconds: 120,
    telemetryKey: "grants.grantee.detail",
    responseSchema: GranteeDetailSchema,
    mapResponse: (p) => (isRecord(p) ? (p as GranteeDetail) : null),
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

// GAP-HR-DISCIPLINARY-DETAIL-03: the backend's GET .../events route already
// existed (disciplinary/routes.ts, disciplinary/repo.ts's listEvents) but
// had no web-side loader calling it, so the case detail page never showed
// its own status-history timeline.
export async function getDisciplinaryCaseEvents(caseId: string): Promise<LoaderResult<DisciplinaryCaseEvent[]>> {
  return fetchJson<unknown, DisciplinaryCaseEvent[]>(`/api/v1/hrms/disciplinary-cases/${caseId}/events`, [], {
    revalidateSeconds: 30,
    telemetryKey: "hrms.disciplinary.events",
    responseSchema: DisciplinaryCaseEventListSchema,
    mapResponse: (payload) => {
      const arr = Array.isArray(payload) ? payload : (payload as { data?: unknown })?.data;
      return Array.isArray(arr) ? (arr as DisciplinaryCaseEvent[]) : null;
    },
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

/**
 * GAP-ESTAB-INBOX-01: files currently on the authenticated officer's desk
 * ("My Desk"), filtered server-side by the backend (currentWith = actor) at
 * /api/v1/estab/files/mine — never the whole register.
 */
export async function getEstabDeskFiles(): Promise<LoaderResult<EstabFileSummary[]>> {
  return fetchJson<unknown, EstabFileSummary[]>("/api/v1/estab/files/mine", [], {
    revalidateSeconds: 30,
    telemetryKey: "estab.files.mine",
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

export async function getLibraryIssues(status?: "issued" | "returned" | "overdue", bookId?: string): Promise<LoaderResult<LibraryIssueSummary[]>> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (bookId) params.set("bookId", bookId);
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
  netBlock: "0",
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
    netBlock: parseMinorString(payload.netBlock),
    recentGrnAssets: recentRaw.flatMap((r) => {
      if (!isRecord(r)) return [];
      const id = toText(r.id);
      if (!id) return [];
      return [{
        id,
        code: toText(r.code) ?? id,
        name: toText(r.name) ?? "Asset",
        acquisitionDate: toText(r.acquisitionDate) ?? "",
        acquisitionCost: parseMinorString(r.acquisitionCost),
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

/**
 * GAP-ASSETS-FIXED-ASSETS-02/06: asset-service pages /assets (default 50, max
 * 200, ordered by code), so a single call silently truncates a larger
 * register. Walk the pages until a short page; any failed page fails the load
 * (a partial register would mislead the totals).
 */
const ASSET_PAGE_SIZE = 200;
const ASSET_MAX_PAGES = 25;
export type AssetRegisterResult = LoaderResult<AssetSummary[]> & {
  /** True when the 5,000-row cap was hit: the register shows the first N rows only. */
  truncated?: boolean;
};
async function fetchAllAssets(query: string, telemetryKey: string): Promise<AssetRegisterResult> {
  const all: AssetSummary[] = [];
  for (let page = 0; page < ASSET_MAX_PAGES; page++) {
    const qs = `${query ? `${query}&` : ""}limit=${ASSET_PAGE_SIZE}&offset=${page * ASSET_PAGE_SIZE}`;
    // The mapper drops malformed rows, so "short page" must be judged on the RAW
    // row count -- otherwise one dropped row ends the walk early.
    let rawCount = 0;
    const res = await fetchJson<unknown, AssetSummary[]>(`/api/v1/asset/assets?${qs}`, [], {
      revalidateSeconds: 120,
      telemetryKey,
      mapResponse: (payload) => {
        rawCount = getArrayPayload(payload)?.length ?? 0;
        return mapAssetSummaries(payload);
      },
    });
    if (res.source === "error") return { ...res, data: [] };
    all.push(...res.data);
    if (rawCount < ASSET_PAGE_SIZE) return { data: all, source: "api" };
  }
  return { data: all, source: "api", truncated: true };
}

export async function getAssets(): Promise<AssetRegisterResult> {
  return fetchAllAssets("", "assets.list");
}

/**
 * GAP-ASSETS-DETAIL-01: the detail page stitches three calls together. `source`
 * describes only the base asset call; `parts` carries each sub-fetch's own
 * source so a failed /depreciation or /maintenance call is shown as "could not
 * load" instead of silently reading as "no schedule" / a hidden history card.
 */
export type AssetDetailParts = { depreciation: LoaderSource; maintenance: LoaderSource };
export type AssetDetailLoaderResult = LoaderResult<AssetDetail | null> & { parts: AssetDetailParts };

export async function getAssetById(id: string): Promise<AssetDetailLoaderResult> {
  const base = await fetchJson<unknown, AssetDetail | null>(`/api/v1/asset/assets/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "assets.detail",
    mapResponse: mapAssetDetail,
  });
  if (!base.data) return { ...base, parts: { depreciation: base.source, maintenance: base.source } };

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
    parts: { depreciation: dep.source, maintenance: maint.source },
  };
}

export async function getFixedAssets(): Promise<AssetRegisterResult> {
  return fetchAllAssets("type=fixed", "assets.fixed");
}

export async function getInfraAssets(): Promise<LoaderResult<AssetSummary[]>> {
  return fetchJson<unknown, AssetSummary[]>("/api/v1/asset/assets?type=infra", [], {
    revalidateSeconds: 120,
    telemetryKey: "assets.infra",
    mapResponse: mapAssetSummaries,
  });
}

/**
 * GAP-ASSETS-REGISTER-02: asset categories (GET /v1/assets/categories). The
 * category carries the depreciation method, rate and useful life the
 * register form must apply instead of a hard-coded category id.
 */
export type AssetCategoryOption = {
  id: string;
  code: string;
  name: string;
  depMethod: "SLM" | "WDV";
  depRate: number;
  usefulLifeYears: number;
};

export function mapAssetCategories(payload: unknown): AssetCategoryOption[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  return rows.flatMap((raw): AssetCategoryOption[] => {
    if (!isRecord(raw)) return [];
    const id = toText(raw.id);
    const name = toText(raw.name);
    const method = toText(raw.depMethod);
    const rate = Number(raw.depRate);
    const life = Number(raw.usefulLifeYears);
    if (!id || !name || (method !== "SLM" && method !== "WDV")) return [];
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(life) || life <= 0) return [];
    return [{ id, code: toText(raw.code) ?? "", name, depMethod: method, depRate: rate, usefulLifeYears: life }];
  });
}

export async function getAssetCategories(): Promise<LoaderResult<AssetCategoryOption[]>> {
  return fetchJson<unknown, AssetCategoryOption[]>("/api/v1/asset/categories", [], {
    revalidateSeconds: 300,
    telemetryKey: "assets.categories",
    mapResponse: mapAssetCategories,
  });
}

/**
 * GAP-ASSETS-LOCATIONS-03: active functional locations the register form places an asset in.
 * The API caps a page at 100, so walk the pages; a failure anywhere is a failure (source "error"), never a short list.
 */
export type AssetLocationOption = { id: string; code: string; name: string; parentId: string | null };

export function mapAssetLocations(payload: unknown): AssetLocationOption[] | null {
  const rows = getArrayPayload(payload);
  if (!rows) return null;
  const out: AssetLocationOption[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const id = toText(r.id);
    const code = toText(r.code);
    const name = toText(r.name);
    if (!id || !code || !name || r.isActive === false) continue;
    out.push({ id, code, name, parentId: toText(r.parentId) });
  }
  return out;
}

export async function getAssetLocations(): Promise<LoaderResult<AssetLocationOption[]>> {
  const PAGE = 100;
  const all: AssetLocationOption[] = [];
  for (let page = 0; page < 50; page++) {
    let raw = 0;
    const res = await fetchJson<unknown, AssetLocationOption[]>(`/api/v1/asset/locations?active=true&limit=${PAGE}&offset=${page * PAGE}`, [], {
      revalidateSeconds: 60,
      telemetryKey: "assets.locations",
      mapResponse: (p) => { raw = getArrayPayload(p)?.length ?? 0; return mapAssetLocations(p); },
    });
    if (res.source === "error") return { ...res, data: [] };
    all.push(...res.data);
    if (raw < PAGE) return { ...res, data: all };
  }
  return { data: all, source: "api" } as LoaderResult<AssetLocationOption[]>;
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
  stockOuts: 0,
  grnsThisMonth: 0,
  inventoryValue: 0,
};

// GAP-STOCK-DASHBOARD-02: a dashboard field that is not a number is a broken
// payload, not a real zero. Return null so fetchJson reports source:"error"
// and the page shows an honest error/"—" state instead of fabricated zeros
// (a hidden low-stock/stock-out count masks a stock-out).
export function mapStockDashboard(payload: unknown): StockDashboard | null {
  if (!isRecord(payload)) return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const totalSKUs = num(payload.totalSKUs);
  const lowStockAlerts = num(payload.lowStockAlerts);
  const grnsThisMonth = num(payload.grnsThisMonth);
  const inventoryValue = num(payload.inventoryValue);
  if (totalSKUs === null || lowStockAlerts === null || grnsThisMonth === null || inventoryValue === null) {
    return null;
  }
  // stockOuts may be absent on an older backend; default it rather than failing.
  const stockOuts = num(payload.stockOuts) ?? 0;
  return { totalSKUs, lowStockAlerts, stockOuts, grnsThisMonth, inventoryValue };
}

export async function getStockDashboard(): Promise<LoaderResult<StockDashboard>> {
  return fetchJson<unknown, StockDashboard>("/api/v1/stock/dashboard", STOCK_DASHBOARD_EMPTY, {
    revalidateSeconds: 60,
    telemetryKey: "stock.dashboard",
    responseSchema: StockDashboardSchema,
    mapResponse: mapStockDashboard,
  });
}

/**
 * Stock items. With no argument this is the service default page (50 items).
 * Callers that must resolve many ids pass `limit` (service max 200) and
 * `offset` to page through the list.
 */
export async function getStockItems(
  opts: { limit?: number; offset?: number } = {},
): Promise<LoaderResult<StockItemSummary[]>> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.offset) qs.set("offset", String(opts.offset));
  const query = qs.toString();
  return fetchJson<unknown, StockItemSummary[]>(`/api/v1/stock/items${query ? `?${query}` : ""}`, [], {
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

export async function getStockLedger(
  opts: { limit?: number; from?: string; to?: string } = {},
): Promise<LoaderResult<StockLedgerEntry[]>> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  const query = qs.toString();
  return fetchJson<unknown, StockLedgerEntry[]>(`/api/v1/stock/ledger${query ? `?${query}` : ""}`, [], {
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
        // GAP-AUDIT-CAG-04: do NOT fall back to the raw reference ids
        // (sourceRef / deptRef) for display — those are opaque internal
        // references, not a human-readable report year or department name.
        // Leave them null so the table/KPIs can render "—" and ignore them,
        // rather than leaking a reference id into a user-facing cell.
        const reportYear = toText(row.reportYear);
        const department = toText(row.department);
        const status = row.status === "settled" ? "settled" :
                       row.status === "closed" ? "settled" :
                       row.status === "replied" ? "partially_settled" :
                       row.status === "pending_recovery" ? "nearly_settled" :
                       "under_review";
        if (!id) continue;
        // GAP-AUDIT-CAG-01: audit-service's GET /v1/audit/paras returns one
        // row PER paragraph (id, paraNo, deptRef, status, amount) and carries
        // NO per-report totalParas/settled/pending aggregate. The previous
        // mapper fabricated totalParas:1 and settled/pending as 0|1 from the
        // row's own status, so those three table columns were constants and
        // the "Total Paras" KPI was just the row count dressed up as a total.
        // Dropped — the page now derives real counts from the row statuses.
        mapped.push({ id, reportYear, paraNo, department, status });
      }
      // GAP-AUDIT-CAG-02: a valid but EMPTY array is an empty register, not a
      // fetch failure. Return [] (source stays "api") so the "No CAG
      // paragraphs found" empty state is reachable; only a payload with rows
      // that ALL fail to parse (a real schema break) falls back to null/error.
      return rows.length > 0 && mapped.length === 0 ? null : mapped;
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
      // GAP-AUDIT-VIGILANCE-01: a valid array (incl. an empty one) must stay
      // source:"api" so the "No vigilance cases found" empty state is reachable
      // for a department with no cases. Only surface source:"error" when rows
      // were received but every row was dropped (missing id / schema break).
      if (rows.length > 0 && mapped.length === 0) return null;
      return mapped;
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
        const rawStatus = toText(row.status) ?? "unknown";
        // GAP-AUDIT-INVESTIGATION-04: do NOT coerce unmodelled statuses to
        // in_progress (that inflated "Active Investigations"); map them to
        // "unknown" so the KPI and pill are honest.
        const status: InvestigationSummary["status"] =
          rawStatus === "in_progress" || rawStatus === "findings_submitted" || rawStatus === "closed"
            ? rawStatus
            : "unknown";
        if (!id) continue;
        mapped.push({ id, caseId, subject, assignedTo, started, findings, status });
      }
      // GAP-AUDIT-INVESTIGATION-01: a valid array (incl. empty) must stay
      // source:"api" so a fresh tenant sees "No investigations found" instead
      // of a failure card. Only return null (→ error) when rows were received
      // but every one was dropped as malformed (missing id).
      if (rows.length > 0 && mapped.length === 0) return null;
      return mapped;
    },
  });
}

// ── Legal loaders ─────────────────────────────────────────────────────────────

const LEGAL_DASHBOARD_EMPTY: LegalDashboard = {
  activeCases: 0,
  hearingsThisWeek: 0,
  ordersPending: 0,
  opinionsDue: 0,
  disposedCases: 0,
  totalCases: 0,
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
    // GAP-LEGAL-OPINIONS-04: the real legal-service returns `{ items: [...] }`
    // of opinions.legal_opinions rows (soughtBy/counselName, status
    // sought|drafted|issued|pending_approval) — not a bare array in the web
    // vocabulary. The bare LegalOpinionSummaryListSchema rejected every real
    // response, so the list silently fell back to empty. Map explicitly.
    mapResponse: mapLegalOpinionSummaries,
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

/**
 * GAP-PLATFORM-ADMIN-TENANT-CONFIG-01/-02: the CALLER's own office config,
 * read from admin-service's real admin_tenants store. Replaces the web card's
 * old hard-coded DEFAULT_CONFIG. Infrastructure identifiers (dbSchema,
 * keycloakRealm) come back null for anyone below platform_admin — the service
 * is the authority on that gate, not the UI. Licence/seat/storage figures the
 * platform does not track yet are null, never fabricated.
 */
export type AdminTenantConfig = {
  tenantId: string;
  tenantName: string;
  domain: string;
  edition: string | null;
  status: string | null;
  region: string | null;
  residency: string | null;
  dbSchema: string | null;
  keycloakRealm: string | null;
  licenseType: string | null;
  licensedUntil: string | null;
  licensedSeats: number | null;
  activeSeats: number | null;
  storageQuotaGb: number | null;
  storageUsedGb: number | null;
  features: string[];
};

export async function getTenantConfig(): Promise<LoaderResult<AdminTenantConfig | null>> {
  return fetchJson<unknown, AdminTenantConfig | null>("/api/v1/admin/tenant-config", null, {
    revalidateSeconds: 60,
    telemetryKey: "admin.tenant-config",
    mapResponse: (payload) => {
      const data = isRecord(payload) && isRecord((payload as Record<string, unknown>).data)
        ? ((payload as Record<string, unknown>).data as Record<string, unknown>)
        : null;
      if (!data) return null;
      const str = (k: string): string | null => (typeof data[k] === "string" && (data[k] as string).length > 0 ? (data[k] as string) : null);
      const num = (k: string): number | null => (typeof data[k] === "number" && Number.isFinite(data[k]) ? (data[k] as number) : null);
      const tenantId = str("tenantId");
      const tenantName = str("tenantName");
      const domain = str("domain");
      if (!tenantId || !tenantName || !domain) return null;
      return {
        tenantId,
        tenantName,
        domain,
        edition: str("edition"),
        status: str("status"),
        region: str("region"),
        residency: str("residency"),
        dbSchema: str("dbSchema"),
        keycloakRealm: str("keycloakRealm"),
        licenseType: str("licenseType"),
        licensedUntil: str("licensedUntil"),
        licensedSeats: num("licensedSeats"),
        activeSeats: num("activeSeats"),
        storageQuotaGb: num("storageQuotaGb"),
        storageUsedGb: num("storageUsedGb"),
        features: Array.isArray(data.features) ? (data.features as unknown[]).filter((f): f is string => typeof f === "string") : [],
      };
    },
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

// GAP-ADMIN-EDITIONS-06: typed row so the table's column keys are checked by tsc.
export async function getSAEditions(): Promise<LoaderResult<EditionRow[]>> {
  return fetchJson<unknown, EditionRow[]>("/api/v1/admin/editions", [], {
    revalidateSeconds: 300, telemetryKey: "sa.editions",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      return rows ? rows.filter(isRecord).map(toEditionRow) : null;
    },
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

// GAP-ADMIN-API-MONITORING-05: typed row so the table's column keys are checked by tsc.
export async function getSAApiMonitoring(): Promise<LoaderResult<ApiEndpointRow[]>> {
  return fetchJson<unknown, ApiEndpointRow[]>("/api/v1/admin/api-monitoring", [], {
    revalidateSeconds: 30, telemetryKey: "sa.api-monitoring",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      // GAP-ADMIN-API-MONITORING-06: a snapshot time on the envelope applies to rows that carry none of their own.
      const env = isRecord(p) ? p : {};
      const meta = isRecord(env.meta) ? env.meta : {};
      const generated = [env.generatedAt, meta.generatedAt].find((x): x is string => typeof x === "string");
      return rows ? rows.filter(isRecord).map((r) => toApiEndpointRow(r, generated)) : null;
    },
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

/**
 * Real, live PM2 fleet snapshot (admin-service's `/v1/admin/operations`,
 * `requireSuperAdmin`-gated, already used by the ops tooling) — NOT a
 * dashboard-specific endpoint. sa-dashboard uses this for an honest
 * "services online / declared" figure instead of a hardcoded literal.
 */
export async function getSAOperationsSnapshot(): Promise<LoaderResult<Record<string, unknown>>> {
  return fetchJson<unknown, Record<string, unknown>>("/api/v1/admin/operations", {}, {
    revalidateSeconds: 15, telemetryKey: "sa.operations",
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

/**
 * GAP-TENANT-ADMIN-SESSIONS-DETAIL-01: one session by id, from identity-service
 * GET /identity/sessions/:id (tenant-scoped + role-gated server-side; 404 for a
 * session outside the caller's tenant). Normalised to the same field names the
 * list uses (ipAddress/userAgent/mfaVerified) so the detail page and the list
 * speak one vocabulary. A 404 surfaces as source:"error" with status 404 so the
 * page can call notFound() rather than show fabricated data.
 */
export type SessionDetailView = {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  mfaVerified: boolean;
  status: "active" | "expired" | "revoked";
  lastActiveAt: string;
  startedAt?: string;
  expiresAt?: string;
};

export async function getSessionById(id: string): Promise<LoaderResult<SessionDetailView | null>> {
  return fetchJson<unknown, SessionDetailView | null>(`/api/identity/sessions/${encodeURIComponent(id)}`, null, {
    revalidateSeconds: 15,
    telemetryKey: "admin.session.detail",
    responseSchema: SessionDetailSchema,
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      const v = p as Record<string, unknown>;
      return {
        id: String(v.id),
        userId: String(v.userId),
        userEmail: String(v.userEmail),
        userName: typeof v.userName === "string" ? v.userName : undefined,
        ipAddress: typeof v.ip === "string" ? v.ip : undefined,
        userAgent: typeof v.userAgent === "string" ? v.userAgent : undefined,
        mfaVerified: v.mfaMethod != null && v.mfaMethod !== "",
        status: v.status as "active" | "expired" | "revoked",
        lastActiveAt: String(v.lastActiveAt),
        startedAt: typeof v.startedAt === "string" ? v.startedAt : undefined,
        expiresAt: typeof v.expiresAt === "string" ? v.expiresAt : undefined,
      };
    },
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

/**
 * GAP-TENANT-ADMIN-BREAKGLASS-DETAIL-01: a single break-glass event by id.
 * The detail page used to render a hard-coded sample record for every id
 * (misleading on a security screen). This loader fetches the real record and
 * renders only the fields the identity service actually returns — resources
 * accessed and the approval chain are optional and are omitted (not invented)
 * when the API does not supply them. A 404 is surfaced via `status` so the
 * page can call notFound(); any other failure drives a RefreshErrorState.
 */
export type BreakglassEventDetail = {
  id: string;
  actor: string;
  actorEmail: string | null;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  closedBy: string | null;
  closeReason: string | null;
  resourcesAccessed: string[] | null;
  approvalChain: { name: string; role: string; decision: string; timestamp: string | null }[] | null;
};

const BreakglassEventDetailSchema: z.ZodType<BreakglassEventDetail, z.ZodTypeDef, unknown> = z
  .object({
    id: z.string(),
    actor: z.string(),
    actorEmail: z.string().nullish().transform((v) => v ?? null),
    reason: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullish().transform((v) => v ?? null),
    status: z.string(),
    closedBy: z.string().nullish().transform((v) => v ?? null),
    closeReason: z.string().nullish().transform((v) => v ?? null),
    resourcesAccessed: z.array(z.string()).nullish().transform((v) => v ?? null),
    approvalChain: z
      .array(
        z.object({
          name: z.string(),
          role: z.string(),
          decision: z.string(),
          timestamp: z.string().nullish().transform((v) => v ?? null),
        }),
      )
      .nullish()
      .transform((v) => v ?? null),
  })
  .passthrough() as unknown as z.ZodType<BreakglassEventDetail, z.ZodTypeDef, unknown>;

export async function getBreakglassEvent(id: string): Promise<LoaderResult<BreakglassEventDetail | null>> {
  return fetchJson<BreakglassEventDetail, BreakglassEventDetail | null>(
    `/api/v1/admin/breakglass/${pathSeg(id)}`,
    null,
    {
      revalidateSeconds: 30,
      telemetryKey: "admin.breakglass.detail",
      responseSchema: BreakglassEventDetailSchema,
      mapResponse: (p) => p,
    },
  );
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

/**
 * GAP-REPORTS-SCHEDULED-01: report templates for the scheduled-report picker.
 * report-service GET /v1/reports/templates returns {data:[{id,name,status,...}]}
 * (templates module routes.ts, verified in this worktree). Only id + name are
 * surfaced here — enough to replace the free-typed Template UUID with a named
 * dropdown and to resolve a schedule row's templateId back to a human name. An
 * empty list is a legitimate "no templates yet" state (returns []), not an error.
 */
export type ReportTemplateOption = { id: string; name: string; status: string };

export async function getReportTemplates(): Promise<LoaderResult<ReportTemplateOption[]>> {
  return fetchJson<unknown, ReportTemplateOption[]>("/api/v1/reports/templates?limit=200", [], {
    revalidateSeconds: 60,
    telemetryKey: "reports.templates",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const out: ReportTemplateOption[] = [];
      for (const r of rows) {
        if (!isRecord(r)) continue;
        const id = toText(r.id);
        const name = toText(r.name);
        if (!id || !name) continue;
        out.push({ id, name, status: toText(r.status) ?? "active" });
      }
      return out;
    },
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

// GAP-PAYROLL-GPF-02 / NPS-02: employeeCode is the real HR employee number
// payroll-service now enriches from hrms (null when unresolved), and
// pranLast4 (NPS only) is the last four characters of the PRAN -- the full
// PRAN never leaves hrms-service.
export type StatutoryRow = { id: string; employeeId: string; employeeName?: string | null; employeeCode?: string | null; pranLast4?: string | null; period: string; empContribMinor?: number | null; erContribMinor?: number | null; basicMinor?: number; reconciliation?: { status: "match" | "mismatch" | "no_hrms_account" | "hrms_unavailable" } | null };

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

// GAP-HR-PAY-MATRIX-03/06: `cells` now also carries `basicMinor` (paise, as
// the backend already sends it) so the page can format/compare/sort real
// money instead of the server-formatted `basicDisplay` string.
// GAP-HR-PAY-MATRIX-04: `designations` (per-level posts) was already
// returned by the backend but dropped here before it ever reached the page.
export type PayMatrixLevel = {
  level: number;
  payGrade: string;
  cells: Array<{ cell: number; basicMinor: string; basicDisplay: string }>;
  designations: Array<{ id: string; code: string; name: string }>;
};
// GAP-HR-PAY-MATRIX-01: `official` says whether the pay data below is the
// real notified 7th CPC table or (today, always) a computed approximation
// -- see the long comment on isPayMatrixOfficial() in
// services/hrms-service/src/modules/pay-matrix/routes.ts. Threaded through
// here (rather than hardcoding the "not official" label on the page) so the
// label automatically stops once the backend genuinely has real data.
export type PayMatrixData = { levels: PayMatrixLevel[]; official: boolean };

export async function getPayMatrix(level?: number): Promise<LoaderResult<PayMatrixData>> {
  const qs = level ? `?level=${level}` : "";
  return fetchJson<unknown, PayMatrixData>(`/api/v1/hrms/pay-matrix${qs}`, { levels: [], official: false }, {
    revalidateSeconds: 300,
    telemetryKey: "hrms.payMatrix",
    mapResponse: (p) => {
      const body = p as { data?: PayMatrixLevel[]; official?: boolean };
      if (!Array.isArray(body?.data)) return null;
      return { levels: body.data, official: body.official ?? false };
    },
  });
}

export type SalarySlipDetail = z.infer<typeof SalarySlipDetailSchema>;

// GAP-PAYROLL-SALARY-SLIPS-DETAIL-01/03, GAP-PAYROLL-SLIPS-DETAIL-03/04: this one
// endpoint used to feed two frontend pages through two different, unvalidated private
// casts (one assumed *Minor + components[], the other assumed a plain SalarySlipSummary
// plus an earnings/deductionItems/statutory shape payroll-service never actually sends).
// SalarySlipDetailSchema is the real response contract (validated, shared with the
// backend's own schema package) -- both hr/payroll/salary-slips/[id] and
// hr/payroll/slips/[id] should read the slip through this loader now, not their own
// bespoke fetchers.
export async function getSlipById(id: string): Promise<LoaderResult<SalarySlipDetail | null>> {
  return fetchJson<unknown, SalarySlipDetail | null>(`/api/v1/payroll/slips/${id}`, null, {
    revalidateSeconds: 60,
    telemetryKey: "hr.salary-slip.detail",
    responseSchema: SalarySlipDetailSchema.nullable(),
    mapResponse: (p) => (isRecord(p) ? (p as SalarySlipDetail) : null),
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

// GAP-PAYROLL-PENSIONERS-05 / PENSIONERS-NEW-03: no `revalidateSeconds`
// any more (was 120) -- a payroll money list, like its sibling loaders, so a
// pensioner just created on /new is not hidden behind a 2-minute data cache.
export async function getPensioners(): Promise<LoaderResult<PensionerSummary[]>> {
  return fetchJson<unknown, PensionerSummary[]>("/api/v1/payroll/pensioners", [], {
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

// GAP-TENANT-ADMIN-SECURITY-02: validate the payload shape so a response
// missing `events` (or with non-numeric counts) becomes source="error" and the
// friendly RefreshErrorState card instead of throwing into error.tsx when the
// page reads overview.events.length. Numbers coerce defensively; events
// defaults to [] and each event is individually validated.
const securityEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  actor: z.string(),
  ipAddress: z.string(),
  outcome: z.string(),
});

const securityOverviewSchema = z.object({
  activeSessions: z.number().finite(),
  failedLogins24h: z.number().finite(),
  mfaAdoptionRate: z.number().finite(),
  trustedDevices: z.number().finite(),
  events: z.array(securityEventSchema),
});

export function mapSecurityOverview(payload: unknown): SecurityOverview | null {
  const parsed = securityOverviewSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export async function getSecurityOverview(): Promise<LoaderResult<SecurityOverview>> {
  return fetchJson<unknown, SecurityOverview>(
    "/api/v1/admin/security/overview",
    { activeSessions: 0, failedLogins24h: 0, mfaAdoptionRate: 0, trustedDevices: 0, events: [] },
    {
      revalidateSeconds: 30,
      telemetryKey: "admin.security.overview",
      mapResponse: mapSecurityOverview,
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
  downloadUrl: string | null;
};

export async function getDataExports(): Promise<LoaderResult<DataExportRequest[]>> {
  // GAP-TENANT-ADMIN-DATA-EXPORT-03: LIST is served by the gap aggregator at
  // the plural path; CREATE/DOWNLOAD use the singular data-export module route.
  return fetchJson<unknown, DataExportRequest[]>("/api/v1/admin/data-exports", [], {
    revalidateSeconds: 30,
    telemetryKey: "admin.data-exports",
    mapResponse: (p) => getArrayPayload(p) as DataExportRequest[] | null,
  });
}

export type OrgHierarchyNode = {
  id: string;
  name: string;
  /**
   * Per-node DIRECT staff count. GAP-TENANT-ADMIN-ORG-HIERARCHY-02: the
   * tenant-service org_units contract carries no rolled-up total, so summing
   * headCount at every level is the correct whole-org figure (NOT a
   * double-count of parent + children). It is optional because the current
   * backend read (GET /v1/org/hierarchy -> flat org_units) does not populate
   * it at all; absent means "unknown", rendered as "—", never a fabricated 0.
   */
  headCount?: number | null;
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
  dpdpScore: number | null;
  certInReadiness: number | null;
  retentionStatus: string;
  checks: ComplianceCheck[];
};

// GAP-TENANT-ADMIN-COMPLIANCE-03: a zod schema so a malformed 200 body (missing
// fields) becomes source "error" instead of rendering "undefined%" or crashing
// `checks.filter`. Scores are nullable so a genuine "no score yet" renders "—"
// (never a fabricated 0%); a real 0 is preserved.
const ComplianceOverviewSchema: z.ZodType<ComplianceOverview, z.ZodTypeDef, unknown> = z
  .object({
    dpdpScore: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
    certInReadiness: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
    retentionStatus: z.string().nullish().transform((v) => v ?? "Unknown"),
    checks: z
      .array(
        z.object({
          id: z.string(),
          timestamp: z.string(),
          title: z.string(),
          result: z.enum(["pass", "warn", "fail"]),
        }),
      )
      .nullish()
      .transform((v) => v ?? []),
  })
  .passthrough() as unknown as z.ZodType<ComplianceOverview, z.ZodTypeDef, unknown>;

export async function getComplianceOverview(): Promise<LoaderResult<ComplianceOverview>> {
  return fetchJson<ComplianceOverview, ComplianceOverview>(
    "/api/v1/admin/compliance",
    { dpdpScore: null, certInReadiness: null, retentionStatus: "Unknown", checks: [] },
    {
      revalidateSeconds: 120,
      telemetryKey: "admin.compliance",
      responseSchema: ComplianceOverviewSchema,
      mapResponse: (p) => p,
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
  /** Max retry attempts, when the API provides it (webhook_deliveries.max_attempts). */
  maxAttempts?: number | null;
  deliveredAt: string;
  responseBody: string;
};

/**
 * GAP-TENANT-ADMIN-WEBHOOKS-02: the create endpoint returns the signing secret
 * exactly once (admin-service webhookCreate -> { id, status, correlationId,
 * secret }). The secret is shown once in a modal and never persisted. maxAttempts
 * lets the delivery log render the real denominator (GAP-WEBHOOKS-06) instead of
 * a hard-coded "/3".
 */
export type WebhookCreated = {
  id: string;
  secret: string;
};

export async function getWebhooks(): Promise<LoaderResult<WebhookSummary[]>> {
  return fetchJson<unknown, WebhookSummary[]>("/api/v1/admin/webhooks", [], {
    revalidateSeconds: 60,
    telemetryKey: "admin.webhooks",
    mapResponse: (p) => getArrayPayload(p) as WebhookSummary[] | null,
  });
}

export async function getWebhookDeliveries(webhookId: string): Promise<LoaderResult<WebhookDelivery[]>> {
  return fetchJson<unknown, WebhookDelivery[]>(`/api/v1/admin/webhooks/${pathSeg(webhookId)}/deliveries`, [], {
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
  /** null when the backend sends no per-module count (shown as a dash, never a fake 0). */
  users: number | null;
  lastActivity: string;
  usage: string;
};

export async function getAdminTenantDetail(id: string): Promise<LoaderResult<AdminTenantDetail | null>> {
  return fetchJson<unknown, AdminTenantDetail | null>(`/api/v1/admin/tenants/${pathSeg(id)}`, null, {
    // GAP-ADMIN-TENANTS-DETAIL-05: not cached -- the page now shows the live
    // status right after a suspend/reactivate/edit is approved.
    revalidateSeconds: 0,
    telemetryKey: "admin.tenant.detail",
    mapResponse: (p) => (isRecord(p) ? (p as AdminTenantDetail) : null),
  });
}

export async function getAdminTenantModules(id: string): Promise<LoaderResult<AdminTenantModuleUsage[]>> {
  return fetchJson<unknown, AdminTenantModuleUsage[]>(`/api/v1/admin/tenants/${pathSeg(id)}/config`, [], {
    revalidateSeconds: 120,
    telemetryKey: "admin.tenant.modules",
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      const modules = getArrayPayload(p.modules ?? p.data ?? p);
      if (!modules) return [];
      return modules.filter(isRecord).map((m) => ({
        module: String(m.module ?? m.name ?? "Unknown"),
        enabled: m.enabled === true || m.enabled === "Yes" ? "Yes" : "No",
        users: typeof m.users === "number" ? m.users : null,
        lastActivity: typeof m.lastActivity === "string" ? m.lastActivity : "—",
        usage: typeof m.usage === "string" ? m.usage : "—",
      }));
    },
  });
}

// ── Tenant lifecycle approval (GAP-ADMIN-TENANTS-DETAIL-05) ───────────────────

export type TenantLifecycleKind = "suspend" | "reactivate" | "edit" | "policy_change";

export type TenantLifecycleRequest = {
  id: string;
  kind: string;
  status: string;
  reason: string;
  payload: Record<string, unknown>;
  effectiveAt: string | null;
  requestedAt: string;
  /** The backend never sends raw actor ids; it says whether the caller is the requester / decider. */
  requestedByYou: boolean;
  requiredApprovals: number;
  approvalsCount: number;
  decidedAt: string | null;
  decidedByYou: boolean;
  decisionReason: string | null;
  failureCode: string | null;
  directExecution: boolean;
  /** Whether the CALLER may approve/reject it now (not the requester, eligible role, still pending). */
  canDecide: boolean;
  /** Whether the CALLER may cancel it (scheduled only; the requester or an approver). */
  canCancel: boolean;
  cancelledByYou: boolean;
  cancelReason: string | null;
};

export type TenantApprovalPolicy = {
  requiresSecondApprover: boolean;
  approverRoles: string[];
  minApprovals: number;
  reasonRequired: boolean;
  notifyTenantAdmins: boolean;
};

export type TenantApprovalPolicyView = {
  policy: TenantApprovalPolicy;
  isDefault: boolean;
  pendingChange: TenantLifecycleRequest | null;
};

export async function getAdminTenantLifecycleRequests(id: string): Promise<LoaderResult<TenantLifecycleRequest[]>> {
  return fetchJson<unknown, TenantLifecycleRequest[]>(`/api/v1/admin/tenants/${pathSeg(id)}/lifecycle-requests?limit=50`, [], {
    revalidateSeconds: 0,
    telemetryKey: "admin.tenant.lifecycle_requests",
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      const items = getArrayPayload(p.items ?? p);
      return items ? (items.filter(isRecord) as unknown as TenantLifecycleRequest[]) : null;
    },
  });
}

export async function getAdminTenantApprovalPolicy(id: string): Promise<LoaderResult<TenantApprovalPolicyView | null>> {
  return fetchJson<unknown, TenantApprovalPolicyView | null>(`/api/v1/admin/tenants/${pathSeg(id)}/approval-policy`, null, {
    revalidateSeconds: 0,
    telemetryKey: "admin.tenant.approval_policy",
    mapResponse: (p) => (isRecord(p) && isRecord(p.policy) ? (p as unknown as TenantApprovalPolicyView) : null),
  });
}

// ── Admin: users / roles / permissions / audit logs / scheduled jobs / feature
// flags (COMP-004) — every loader below reads a route COMP-001 already made
// real (users/roles/permissions/audit-logs/org-hierarchy in admin-service's
// gap/routes.ts) or that ships fully built in its own admin-service module
// (feature-flags/manage, scheduled-jobs). No mock fallback. ──────────────────

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string;
  empCode: string | null;
  status: "active" | "suspended" | "locked" | "deactivated";
  mfaEnabled: boolean;
};

/** Rows per page of the user directory (the route caps `limit` at 200). */
export const ADMIN_USERS_PAGE_SIZE = 25;

export type AdminUserStatusCounts = { active: number; suspended: number; locked: number; deactivated: number };
export type AdminUsersPage = {
  rows: AdminUserSummary[];
  /** Users matching the current search/filter, across ALL pages. */
  total: number;
  /** Tenant-wide per-status counts (independent of the filter), or null when the API did not send them. */
  counts: AdminUserStatusCounts | null;
  page: number;
  pageSize: number;
};
export type AdminUsersQuery = { q?: string; status?: AdminUserSummary["status"]; page?: number };

const USER_STATUSES = ["active", "suspended", "locked", "deactivated"] as const;
export function isUserStatus(v: unknown): v is AdminUserSummary["status"] {
  return typeof v === "string" && (USER_STATUSES as readonly string[]).includes(v);
}

function toCounts(v: unknown): AdminUserStatusCounts | null {
  if (!isRecord(v)) return null;
  const n = (k: string) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k] as number) : 0);
  return { active: n("active"), suspended: n("suspended"), locked: n("locked"), deactivated: n("deactivated") };
}

/** GAP-ADMIN-USERS-03: one server-side page of the directory with the real total (GET /v1/admin/users?q=&status=&limit=&offset=). */
export async function getAdminUsersPage(query: AdminUsersQuery = {}): Promise<LoaderResult<AdminUsersPage>> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const params = new URLSearchParams({ limit: String(ADMIN_USERS_PAGE_SIZE), offset: String((page - 1) * ADMIN_USERS_PAGE_SIZE) });
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  return fetchJson<unknown, AdminUsersPage>(`/api/v1/admin/users?${params.toString()}`, { rows: [], total: 0, counts: null, page, pageSize: ADMIN_USERS_PAGE_SIZE }, {
    telemetryKey: "admin.users.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const meta = isRecord(p) && isRecord(p.meta) ? p.meta : {};
      const mapped = rows.filter(isRecord).map((u) => ({
        id: String(u.id ?? ""),
        email: String(u.email ?? ""),
        name: String(u.name ?? ""),
        empCode: toText(u.empCode),
        status: (isUserStatus(u.status) ? u.status : "active") as AdminUserSummary["status"],
        mfaEnabled: u.mfaEnabled === true,
      }));
      return {
        rows: mapped,
        total: typeof meta.total === "number" && Number.isFinite(meta.total) ? meta.total : mapped.length,
        counts: toCounts(meta.counts),
        page,
        pageSize: ADMIN_USERS_PAGE_SIZE,
      };
    },
  });
}

export type AdminRoleSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

export async function getAdminRolesList(): Promise<LoaderResult<AdminRoleSummary[]>> {
  return fetchJson<unknown, AdminRoleSummary[]>("/api/v1/admin/roles?limit=200", [], {
    telemetryKey: "admin.roles.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((r) => ({
        id: String(r.id ?? ""),
        key: String(r.key ?? ""),
        name: String(r.name ?? r.key ?? ""),
        description: toText(r.description),
        isSystem: r.isSystem === true,
      }));
    },
  });
}

export type AdminPermissionSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
};

export async function getAdminPermissionsList(): Promise<LoaderResult<AdminPermissionSummary[]>> {
  return fetchJson<unknown, AdminPermissionSummary[]>("/api/v1/admin/permissions?limit=200", [], {
    telemetryKey: "admin.permissions.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((perm) => ({
        id: String(perm.id ?? ""),
        key: String(perm.key ?? ""),
        name: String(perm.name ?? perm.key ?? ""),
        description: toText(perm.description),
      }));
    },
  });
}

export type AdminAuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  resource: string | null;
  outcome: "success" | "failure";
  timestamp: string;
};

/** Events per audit-log page; admin-service caps `limit` at 200. */
export const ADMIN_AUDIT_LOG_PAGE_SIZE = 200;

/**
 * GAP-ADMIN-AUDIT-LOG-02: `offset` pages back through older events (the API is
 * newest-first with limit/offset) so events beyond the newest 200 stay reachable.
 */
export async function getAdminAuditLogEntries(offset = 0): Promise<LoaderResult<AdminAuditLogEntry[]>> {
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  return fetchJson<unknown, AdminAuditLogEntry[]>(`/api/v1/admin/audit-logs?limit=${ADMIN_AUDIT_LOG_PAGE_SIZE}&offset=${safeOffset}`, [], {
    telemetryKey: "admin.audit-logs.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((e) => ({
        id: String(e.id ?? ""),
        actor: String(e.actor ?? "system"),
        action: String(e.action ?? ""),
        resource: toText(e.resource),
        outcome: e.outcome === "failure" ? "failure" : "success",
        timestamp: String(e.timestamp ?? ""),
      }));
    },
  });
}

export type AdminScheduledJob = {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  targetService: string;
  targetCommand: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "failed" | "running" | "never_run";
  nextRunAt: string | null;
};

export async function getAdminScheduledJobs(): Promise<LoaderResult<AdminScheduledJob[]>> {
  return fetchJson<unknown, AdminScheduledJob[]>("/api/v1/admin/scheduled-jobs", [], {
    telemetryKey: "admin.scheduled-jobs.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((j) => ({
        id: String(j.id ?? ""),
        name: String(j.name ?? ""),
        description: String(j.description ?? ""),
        cronExpression: String(j.cronExpression ?? ""),
        timezone: String(j.timezone ?? "Asia/Kolkata"),
        targetService: String(j.targetService ?? ""),
        targetCommand: String(j.targetCommand ?? ""),
        payload: isRecord(j.payload) ? j.payload : {},
        enabled: j.enabled === true,
        lastRunAt: toText(j.lastRunAt),
        lastRunStatus: (["success", "failed", "running", "never_run"].includes(String(j.lastRunStatus)) ? j.lastRunStatus : "never_run") as AdminScheduledJob["lastRunStatus"],
        nextRunAt: toText(j.nextRunAt),
      }));
    },
  });
}

/** GAP-ADMIN-SCHEDULED-JOBS-02: what a job may target (GET /v1/admin/scheduled-jobs/targets). */
export type AdminScheduledJobTarget = { service: string; commandPrefix: string; sensitive: boolean; allowList: string[] | null; /** False for a sensitive service with no configured allow-list. */ schedulable: boolean };
export type AdminScheduledJobTargets = { services: AdminScheduledJobTarget[]; commandFormat: string; payloadMaxChars: number };

export async function getAdminScheduledJobTargets(): Promise<LoaderResult<AdminScheduledJobTargets | null>> {
  return fetchJson<unknown, AdminScheduledJobTargets | null>("/api/v1/admin/scheduled-jobs/targets", null, {
    telemetryKey: "admin.scheduled-jobs.targets",
    mapResponse: (p) => {
      const d = isRecord(p) && isRecord(p.data) ? p.data : null;
      if (!d || !Array.isArray(d.services)) return null;
      return {
        services: d.services.filter(isRecord).map((r) => ({
          service: String(r.service ?? ""),
          commandPrefix: String(r.commandPrefix ?? ""),
          sensitive: r.sensitive === true,
          allowList: Array.isArray(r.allowList) ? r.allowList.map(String) : null,
          schedulable: r.schedulable !== false,
        })),
        commandFormat: String(d.commandFormat ?? "service.entity.action"),
        payloadMaxChars: typeof d.payloadMaxChars === "number" ? d.payloadMaxChars : 10000,
      };
    },
  });
}

export type AdminFeatureFlagRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  targetSegments: string[];
  killSwitch: boolean;
  owner: string;
};

export async function getAdminFeatureFlagsManage(): Promise<LoaderResult<AdminFeatureFlagRow[]>> {
  return fetchJson<unknown, AdminFeatureFlagRow[]>("/api/v1/admin/feature-flags/manage", [], {
    telemetryKey: "admin.feature-flags.manage",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((f) => ({
        id: String(f.id ?? ""),
        key: String(f.key ?? ""),
        name: String(f.name ?? ""),
        description: String(f.description ?? ""),
        enabled: f.enabled === true,
        rolloutPercent: typeof f.rolloutPercent === "number" ? f.rolloutPercent : 0,
        targetSegments: Array.isArray(f.targetSegments) ? f.targetSegments.map(String) : [],
        killSwitch: f.killSwitch === true,
        owner: String(f.owner ?? ""),
      }));
    },
  });
}

export type AdminOrgUnit = {
  id: string;
  tenantId: string;
  name: string;
  type: "department" | "division" | "section" | "unit" | "branch";
  parentId: string | null;
  headUserId: string | null;
  code: string | null;
  /** GAP-ADMIN-ORG-03: end date; a unit whose end date has passed is deactivated (kept for history). */
  effectiveTo?: string | null;
};

export async function getAdminOrgUnits(): Promise<LoaderResult<AdminOrgUnit[]>> {
  return fetchJson<unknown, AdminOrgUnit[]>("/api/v1/admin/org-hierarchy", [], {
    telemetryKey: "admin.org-hierarchy.units",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      const ORG_UNIT_TYPES = ["department", "division", "section", "unit", "branch"];
      return rows.filter(isRecord).map((u) => ({
        id: String(u.id ?? ""),
        tenantId: String(u.tenantId ?? ""),
        name: String(u.name ?? ""),
        type: (ORG_UNIT_TYPES.includes(String(u.type)) ? u.type : "unit") as AdminOrgUnit["type"],
        parentId: toText(u.parentId),
        headUserId: toText(u.headUserId),
        code: toText(u.code),
        effectiveTo: toText(u.effectiveTo),
      }));
    },
  });
}

export type OrgHierarchyLevel = {
  id: string;
  order: number;
  label: string;
  description: string;
  examples: string;
  color: string;
};

// COMP-014: platform-admin/org-config's hierarchy-LEVEL taxonomy (how many
// reporting tiers exist, each tier's label/description/examples/color) --
// backed by admin-service's new org-hierarchy-levels module, tenant override
// with platform-default fallback (migration 0033). Deliberately a distinct
// loader/path from getAdminOrgUnits above (org-UNIT instances, a different
// concept entirely -- see that function's own comment).
export async function getOrgHierarchyLevels(): Promise<LoaderResult<OrgHierarchyLevel[]>> {
  return fetchJson<unknown, OrgHierarchyLevel[]>("/api/v1/admin/org-hierarchy-levels", [], {
    telemetryKey: "admin.org-hierarchy-levels",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((l) => ({
        id: String(l.id ?? ""),
        order: typeof l.order === "number" ? l.order : 0,
        label: String(l.label ?? ""),
        description: String(l.description ?? ""),
        examples: String(l.examples ?? ""),
        color: normalizeHexColor(typeof l.color === "string" ? l.color : null),
      }));
    },
  });
}

export type AdminRoleDetail = AdminRoleSummary & { permissionKeys: string[] };

export async function getAdminRoleDetail(id: string): Promise<LoaderResult<AdminRoleDetail | null>> {
  return fetchJson<unknown, AdminRoleDetail | null>(`/api/v1/admin/roles/${id}`, null, {
    telemetryKey: "admin.roles.detail",
    mapResponse: (p) => {
      if (!isRecord(p)) return null;
      return {
        id: String(p.id ?? ""),
        key: String(p.key ?? ""),
        name: String(p.name ?? p.key ?? ""),
        description: toText(p.description),
        isSystem: p.isSystem === true,
        permissionKeys: Array.isArray(p.permissions) ? p.permissions.map(String) : [],
      };
    },
  });
}

export type RoleFeatureGrant = {
  id: string;
  roleName: string;
  featureKey: string;
  granted: boolean;
};

export async function getRoleFeatureGrants(): Promise<LoaderResult<RoleFeatureGrant[]>> {
  return fetchJson<unknown, RoleFeatureGrant[]>("/api/v1/policy/role-features", [], {
    telemetryKey: "policy.role-features.list",
    mapResponse: (p) => {
      const rows = getArrayPayload(p);
      if (!rows) return null;
      return rows.filter(isRecord).map((g) => ({
        id: String(g.id ?? ""),
        roleName: String(g.roleName ?? ""),
        featureKey: String(g.featureKey ?? ""),
        granted: g.granted !== false,
      }));
    },
  });
}

// ── Project sub-resource loaders ──────────────────────────────────────────────

export type ProjectEscalationRow = {
  escalationId: string;
  projectId?: string;
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
  // GAP-PROJECTS-DPR-TRACKING-03: opaque project id for linking the DPR to
  // /projects/<id>. Optional until the endpoint returns it (now does).
  projectId?: string;
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
  // GAP-PROJECTS-WBS-03: the portfolio WBS endpoint spans every project's
  // tasks; projectId lets a node be traced back to its project. Optional so
  // older cached payloads (pre-fix) still satisfy the type.
  projectId?: string;
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
  // GAP-PROJECTS-DELAY-ANALYSIS-02: opaque project id for linking to
  // /projects/<id>. Optional until the delay-analysis endpoint returns it;
  // the table leaves rows un-linked while it is absent.
  projectId?: string;
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
  instanceId: string;
  module: string;
  status: string;
  assignedAt: string;
  dueDate: string | null;
  link: string;
};

/**
 * GAP-APPROVALS-HOME-01: the unified inbox page needs the WHOLE pending count,
 * not just the length of the page it was handed, plus whether a next page
 * exists, so it can show a real "Pending" stat and offer server-side paging
 * instead of silently capping an approver at the first `pageSize` items. The
 * workflow task-list endpoint now returns `pagination.total` (and `hasMore`);
 * when a service predating that is in front of us, `total` is absent and the
 * page falls back to the loaded count (documented at the call site).
 */
export type MyApprovalsPage = {
  items: MyApprovalItem[];
  /** Exact count of the whole pending set, or null when the API omits it. */
  total: number | null;
  /** True when there are more items beyond this page. */
  hasMore: boolean;
};

const MY_APPROVALS_EMPTY: MyApprovalsPage = { items: [], total: null, hasMore: false };

export async function getMyApprovals(page = 1, pageSize = 15): Promise<LoaderResult<MyApprovalsPage>> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const safePageSize = Math.min(Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 15, 200);
  const params = new URLSearchParams({
    status: "pending",
    limit: String(safePageSize),
    offset: String((safePage - 1) * safePageSize),
  });
  return fetchJson<unknown, MyApprovalsPage>(
    `/api/v1/workflow/tasks?${params.toString()}`,
    MY_APPROVALS_EMPTY,
    {
      revalidateSeconds: 30,
      telemetryKey: "approvals.my",
      mapResponse: (payload) => {
        const rows = getArrayPayload(payload);
        if (!rows) return null;
        const items = rows.filter(isRecord).map((row) => {
          const refType = String(row.refType ?? row.ref_type ?? "");
          const module = refType.split("_")[0] || "workflow";
          const refId = String(row.refId ?? row.ref_id ?? "");
          const taskId = String(row.id ?? "");
          const instanceId = String(row.instanceId ?? row.instance_id ?? "");
          return {
            id: taskId,
            taskId,
            instanceName: String(row.name ?? row.instanceName ?? "Approval Task"),
            refType,
            refId,
            instanceId,
            module,
            status: String(row.status ?? "pending"),
            assignedAt: String(row.createdAt ?? row.created_at ?? ""),
            dueDate: row.dueAt ? String(row.dueAt) : row.due_at ? String(row.due_at) : null,
            link: buildApprovalLink(module, refType, refId, instanceId),
          };
        });
        const pagination = isRecord(payload) && isRecord(payload.pagination) ? payload.pagination : null;
        const totalRaw = pagination?.total;
        const total = typeof totalRaw === "number" && Number.isFinite(totalRaw) ? totalRaw : null;
        const hasMore =
          typeof pagination?.hasMore === "boolean"
            ? pagination.hasMore
            : total !== null
              ? (safePage - 1) * safePageSize + items.length < total
              : false;
        return { items, total, hasMore };
      },
    },
  );
}

/**
 * GAP-APPROVALS-HOME-02: map a workflow task's polymorphic refType to the real
 * detail route for that record. Extracted as a pure, exported function with a
 * closed route table so every branch can be unit-tested against the actual app
 * routes — the previous inline switch had emitted paths that 404'd
 * (/finance/bills/<id>, /workflow/tasks). Every returned path corresponds to a
 * page that exists under apps/web/src/app/(app); an unmapped refType falls back
 * to the generic workflow inbox (/workflow/my-tasks), never a dead route.
 */
export function buildApprovalLink(module: string, refType: string, refId: string, instanceId: string): string {
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
      return `/finance/expenditure/bills/${refId}`;
    case "estab_file":
      return `/estab/files/${refId}`;
    default:
      // No confirmed detail route for this refType: send the approver to the
      // workflow instance when we know it, else the generic tasks inbox. Both
      // routes exist; never emit an unmapped (404) path.
      return instanceId ? `/workflow/instances/${instanceId}` : `/workflow/my-tasks`;
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

/**
 * GAP-HELPDESK-CATALOGUE-MY-REQUESTS-02: a single service request's detail,
 * including (when the backend provides them) a rejection reason and stage
 * history. Additive, optional fields so the loader stays tolerant of a
 * service that has not yet rolled this shape out.
 */
export type ServiceRequestStageEvent = {
  stage: string;
  enteredAt: string;
  note?: string | null;
};
export type ServiceRequestDetail = ServiceRequestSummary & {
  rejectionReason?: string | null;
  stageHistory?: ServiceRequestStageEvent[];
};

export async function getServiceRequest(id: string): Promise<LoaderResult<ServiceRequestDetail | null>> {
  return fetchJson<unknown, ServiceRequestDetail | null>(
    `/api/v1/helpdesk/catalogue/requests/${encodeURIComponent(id)}`,
    null,
    {
      revalidateSeconds: 15,
      telemetryKey: "helpdesk.catalogue.request.detail",
      mapResponse: (payload) => {
        const raw =
          payload && typeof payload === "object" && "data" in payload
            ? (payload as { data: unknown }).data
            : payload;
        if (!raw || typeof raw !== "object") return null;
        const r = raw as Record<string, unknown>;
        if (typeof r.id !== "string") return null;
        const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
        const history = Array.isArray(r.stageHistory)
          ? r.stageHistory
              .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
              .map((e) => ({
                stage: typeof e.stage === "string" ? e.stage : "",
                enteredAt: typeof e.enteredAt === "string" ? e.enteredAt : "",
                note: typeof e.note === "string" ? e.note : null,
              }))
              .filter((e) => e.stage !== "")
          : undefined;
        return {
          id: r.id,
          offeringId: str(r.offeringId) ?? "",
          ticketId: str(r.ticketId),
          requestedBy: str(r.requestedBy) ?? "",
          status: str(r.status) ?? "unknown",
          currentStage: str(r.currentStage),
          slaStatus: str(r.slaStatus) ?? "within_sla",
          resolutionDeadline: str(r.resolutionDeadline),
          breachEscalatedAt: str(r.breachEscalatedAt),
          createdAt: str(r.createdAt) ?? "",
          rejectionReason: str(r.rejectionReason),
          stageHistory: history,
        } satisfies ServiceRequestDetail;
      },
    },
  );
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
  // GAP-...-SCORECARD-05: display figures can be genuinely unknown (no GRNs
  // yet, a dimension not scored). Model that as null so the UI shows "—"
  // instead of a fabricated red 0. overallRating/band stay required.
  overallRating: number | null;
  ratingBand: string;
  totalOrders: number | null;
  onTimeDeliveries: number | null;
  lateDeliveries: number | null;
  qualityRejections: number | null;
  slaBreaches: number | null;
  deliveryScore: number | null;
  qualityScore: number | null;
  slaScore: number | null;
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
  // GAP-PROCUREMENT-PLANNING-02: the list endpoint (planning/queries.listPlans
  // -> serializePlan spreads the full PlanRow) already returns planNo, the
  // human "APP/2026/001"-style number; surface it so the list can show it
  // instead of a UUID fragment.
  planNo?: string;
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

// ── GAP-ADMIN-DISCOVERY-02: service discovery registry ──────────────────────
export type { DiscoveryService, DiscoveryRegistry } from "@/lib/admin/discoveryRegistry";
export const mapDiscoveryRegistry = mapDiscoveryRegistryImpl;

export async function getAdminDiscovery(): Promise<LoaderResult<DiscoveryRegistryModel>> {
  return fetchJson<unknown, DiscoveryRegistryModel>(
    "/api/v1/admin/discovery/services",
    { services: [], checkedAt: null, overall: null, throttled: false },
    { telemetryKey: "admin.discovery", mapResponse: mapDiscoveryRegistry },
  );
}

// ── GAP-ADMIN-SETTINGS-01: stored tenant settings (GET /v1/admin/settings) ──
export type AdminSettingsSection = { configured: boolean; values: Record<string, unknown>; version: number };
export type AdminSettings = {
  general: AdminSettingsSection;
  email: AdminSettingsSection;
  security: AdminSettingsSection;
  integrations: AdminSettingsSection;
  /** True when an SMTP password is stored. The password itself is never returned. */
  hasSmtpPassword: boolean;
  logo: { present: boolean; contentType: string | null; sizeBytes: number | null };
};

function toSettingsSection(v: unknown): AdminSettingsSection {
  const o = isRecord(v) ? v : {};
  return { configured: o.configured === true, values: isRecord(o.values) ? o.values : {}, version: typeof o.version === "number" ? o.version : 0 };
}

/** Null when the payload is not a settings document, so a bad answer is an error, never "blank settings". */
export function mapAdminSettings(p: unknown): AdminSettings | null {
  const d = isRecord(p) && isRecord(p.data) ? p.data : null;
  if (!d || !isRecord(d.general) || !isRecord(d.email) || !isRecord(d.security) || !isRecord(d.integrations)) return null;
  const email = toSettingsSection(d.email);
  const logo = isRecord(d.logo) ? d.logo : {};
  return {
    general: toSettingsSection(d.general),
    email,
    security: toSettingsSection(d.security),
    integrations: toSettingsSection(d.integrations),
    hasSmtpPassword: email.values.hasPassword === true,
    logo: {
      present: logo.present === true,
      contentType: typeof logo.contentType === "string" ? logo.contentType : null,
      sizeBytes: typeof logo.sizeBytes === "number" ? logo.sizeBytes : null,
    },
  };
}

export async function getAdminSettings(): Promise<LoaderResult<AdminSettings | null>> {
  return fetchJson<unknown, AdminSettings | null>("/api/v1/admin/settings", null, { telemetryKey: "admin.settings", mapResponse: mapAdminSettings });
}

// ── GAP-ADMIN-INVOICES-06: invoice detail (GET /v1/billing/invoices/:id) ────
export type AdminInvoiceItem = { id: string; description: string; kind: string; quantity: string; amountMinor: string };
export type AdminInvoiceApproval = { id: string; action: string; status: string; amountMinor: string; decidedAt: string | null; reason: string | null };
export type AdminInvoiceDetail = {
  id: string;
  periodMonth: string;
  status: string;
  currency: string;
  totalMinor: string;
  taxMinor: string;
  chargesMinor: string;
  paidMinor: string;
  outstandingMinor: string;
  issuedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: AdminInvoiceItem[];
  approvals: AdminInvoiceApproval[];
};

const minorText = (v: unknown): string => (typeof v === "string" && /^-?\d+$/.test(v) ? v : typeof v === "number" && Number.isFinite(v) ? String(Math.trunc(v)) : "0");

/** Null when the body is not an invoice, so it surfaces as an error rather than an empty invoice. */
export function mapInvoiceDetail(p: unknown): AdminInvoiceDetail | null {
  if (!isRecord(p) || typeof p.id !== "string" || p.id === "") return null;
  return {
    id: p.id,
    periodMonth: String(p.periodMonth ?? ""),
    status: String(p.status ?? ""),
    currency: String(p.currency ?? "INR"),
    totalMinor: minorText(p.totalMinor),
    taxMinor: minorText(p.taxMinor),
    chargesMinor: minorText(p.chargesMinor),
    paidMinor: minorText(p.paidMinor),
    outstandingMinor: minorText(p.outstandingMinor),
    issuedAt: toText(p.issuedAt),
    paidAt: toText(p.paidAt),
    cancelledAt: toText(p.cancelledAt),
    cancelReason: toText(p.cancelReason),
    items: (Array.isArray(p.items) ? p.items : []).filter(isRecord).map((i) => ({
      id: String(i.id ?? ""), description: String(i.description ?? ""), kind: String(i.kind ?? "line"),
      quantity: minorText(i.quantity), amountMinor: minorText(i.amountMinor),
    })),
    approvals: (Array.isArray(p.approvals) ? p.approvals : []).filter(isRecord).map((a) => ({
      id: String(a.id ?? ""), action: String(a.action ?? ""), status: String(a.status ?? ""),
      amountMinor: minorText(a.amountMinor), decidedAt: toText(a.decidedAt), reason: toText(a.reason),
    })),
  };
}

export async function getAdminInvoiceDetail(id: string): Promise<LoaderResult<AdminInvoiceDetail | null>> {
  return fetchJson<unknown, AdminInvoiceDetail | null>(`/api/v1/billing/invoices/${encodeURIComponent(id)}`, null, {
    telemetryKey: "admin.invoice.detail",
    mapResponse: mapInvoiceDetail,
  });
}

/** GAP-ADMIN-INVOICES-06: the invoice's offline-payment requests and reminder status (each read can fail on its own). */
export async function getInvoiceOpsData(id: string, includeSettings: boolean): Promise<{ payments: OfflinePaymentView[] | null; reminders: ReminderView | null; settings: BillingSettingsView | null }> {
  const [p, r, st] = await Promise.all([
    fetchJson<unknown, OfflinePaymentView[] | null>(`/api/v1/billing/invoices/${encodeURIComponent(id)}/offline-payments`, null, { telemetryKey: "admin.invoice.offline", mapResponse: mapOfflinePayments }),
    fetchJson<unknown, ReminderView | null>(`/api/v1/billing/invoices/${encodeURIComponent(id)}/reminders`, null, { telemetryKey: "admin.invoice.reminders", mapResponse: mapReminderStatus }),
    // Settings are platform-operator data: only asked for when the caller may use them.
    includeSettings
      ? fetchJson<unknown, BillingSettingsView | null>("/api/v1/billing/settings", null, { telemetryKey: "admin.billing.settings", mapResponse: mapBillingSettings })
      : Promise.resolve({ data: null, source: "api" as const }),
  ]);
  return { payments: p.source === "error" ? null : p.data, reminders: r.source === "error" ? null : r.data, settings: st.source === "error" ? null : st.data };
}

/**
 * GAP-ADMIN-BULK-SCAN-02: scanned bills / vouchers / receipts linked to a finance payment, bill or voucher
 * (masked metadata only; paise stay base-10 strings). A failed load is source:"error", never an empty list.
 */
export async function getFinanceScannedDocuments(kind: ScannedDocumentsKind, id: string): Promise<LoaderResult<ScannedDocument[]>> {
  return fetchJson<unknown, ScannedDocument[]>(scannedDocumentsPath(kind, id), [], {
    telemetryKey: "finance.scanned-documents",
    mapResponse: mapScannedDocuments,
  });
}

/**
 * GAP-ADMIN-BULK-SCAN-02: scanned letters / orders filed onto an eOffice file (masked metadata only).
 * A failed load is source:"error", never an empty list.
 */
export async function getEstabScannedDocuments(fileId: string): Promise<LoaderResult<EstabScannedDocument[]>> {
  return fetchJson<unknown, EstabScannedDocument[]>(estabScannedDocumentsPath(fileId), [], {
    telemetryKey: "estab.file.scanned-documents",
    mapResponse: mapEstabScannedDocuments,
  });
}
