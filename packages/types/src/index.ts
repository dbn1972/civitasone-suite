// Vol 3: every entity must carry tenant_id, timestamps, actor fields
export interface BaseEntity {
  id: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  version: number;
}

// Vol 4: standard error envelope for every API response
export interface ApiError {
  code: string;
  message: string;
  detail?: string;
  correlationId: string;
  retryable: boolean;
  fieldErrors?: FieldError[];
}

export interface FieldError {
  field: string;
  message: string;
}

// Vol 4: standard paginated response
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    cursor?: string;
    hasMore: boolean;
    total?: number;
    pageSize: number;
  };
}

// Vol 6: audit event structure — immutable, tenant-scoped
export interface AuditEvent {
  id: string;
  tenantId: string;
  actorId: string;
  actorType: 'user' | 'service_account' | 'system' | 'support';
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'success' | 'failure';
  correlationId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Vol 1: tenant lifecycle states (Vol 2 §9.1)
export type TenantStatus =
  | 'draft'
  | 'active'
  | 'suspended'
  | 'restricted'
  | 'offboarding'
  | 'archived';

// Vol 2: plan and entitlement are separate concerns
export interface TenantPlan {
  planId: string;
  planName: string;
  entitlements: string[];
  quotas: Record<string, number>;
}

// Vol 4: API request context — resolved by gateway before every handler
export interface RequestContext {
  tenantId: string;
  actorId: string;
  actorType: 'user' | 'service_account';
  roles: string[];
  correlationId: string;
  sessionId?: string;
  /** District org-model claims (EPIC-2). Populated from the caller's active
   * posting when present in the token; absent for non-office principals. These
   * let RLS/ABAC fence access by office, position and jurisdiction rather than
   * by tenant + role alone. */
  officeId?: string;
  positionId?: string;
  deptCode?: string;
  hierarchyDomain?: string;
  jurisdictionUnitIds?: string[];
  clearanceLevel?: string;
  /** EVT-4 (04-T4): client-supplied idempotency key (x-idempotency-key header).
   * Sensitive write commands derive a deterministic messageId from it so a
   * double-submit dedupes at the consumer instead of creating two events. */
  idempotencyKey?: string;
}

// Vol 7: plugin manifest
export interface PluginManifest {
  name: string;
  publisher: string;
  version: string;
  supportedProductVersions: string[];
  permissions: string[];
  extensionPoints: string[];
  configSchema?: Record<string, unknown>;
  tenantScope: 'tenant' | 'platform';
}

// Vol 7: theme manifest
export interface ThemeManifest {
  name: string;
  publisher: string;
  version: string;
  supportedProductVersions: string[];
  tokens: Record<string, string>;
  assets?: string[];
  configSchema?: Record<string, unknown>;
  tenantScope: 'tenant' | 'platform' | 'public_site';
}

// Web summary models: shared lightweight contracts used by module landing screens
export interface NavTile {
  title: string;
  href: string;
  description?: string;
}

export interface MetricCard {
  label: string;
  value: string;
  note?: string;
}

export interface CRMDealSummary {
  id: string;
  name: string;
  stage: 'Lead' | 'Proposal' | 'Negotiation' | 'Won' | 'Lost';
  valueDisplay: string;
}

/**
 * One assistant chat conversation. `status` is left as a string rather than a
 * union so a new status added by ai-agent-service does not fail validation and
 * blank the screen.
 */
/** Why a chat conversation was escalated from the bot to a person. */
export type ChatHandoffReason =
  | "requested"
  | "low_confidence"
  | "guardrail"
  | "agent_initiated";

/**
 * Transcript snapshot handed to the receiving human agent. Guardrail-sanitised
 * text only — raw personal data is never persisted (DPDP Act 2023).
 */
export interface ChatHandoffContext {
  conversationId: string;
  language: string;
  reasonCode: ChatHandoffReason;
  note: string | null;
  summary: {
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    systemMessages: number;
    totalTokens: number;
    lastRole: string | null;
  };
  recentTurns: { role: string; content: string }[];
}

export interface ChatConversation {
  id: string;
  channelId: string;
  profileId: string | null;
  /** active | handed_off | ended */
  status: string;
  language: string;
  startedAt: string;
  endedAt: string | null;
  handedOffAt: string | null;
  handoffReason: string | null;
  handoffNote: string | null;
  handoffQueue: string | null;
  handoffContext: ChatHandoffContext | null;
  version: number;
}

/** One message in a chat transcript. */
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  tokens: number | null;
  createdAt: string;
}

/** A retrieved document cited by a copilot answer. */
export interface CopilotCitation {
  id: string;
  title?: string;
  url?: string;
  /** Retrieval relevance, when the retriever reported one. */
  score?: number;
}

/**
 * One copilot question and its answer. `response` is null until the consumer
 * has produced the answer — the ask endpoint returns 202, not the answer.
 */
export interface CopilotTurn {
  id: string;
  userId: string | null;
  prompt: string;
  response: string | null;
  sourceCitations: CopilotCitation[];
  model: string | null;
  tokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  version: number;
  /** Latency band as classified by ai-agent-service; only on the detail read. */
  latencyBucket?: 'fast' | 'normal' | 'slow' | null;
}

/** Health bands owned by recommendation-service scoring. */
export type HealthBand = 'critical' | 'at_risk' | 'healthy' | 'thriving';

/** One account on the health watchlist. */
export interface AccountHealthEntry {
  accountId: string;
  /** Integer 0–100. */
  score: number;
  band: HealthBand;
  computedAt: string;
}

/** One weighted signal behind an account's health score. */
export interface AccountHealthFactor {
  signal: string;
  value: number;
  weight: number;
  contribution: number;
  /** True when the upstream signal was out of range and was clamped. */
  clamped: boolean;
}

/** Full health breakdown for a single account. */
export interface AccountHealthBreakdown {
  accountId: string;
  /** Score recomputed from the signals below — always agrees with `band`. */
  score: number;
  /** Score as persisted; may lag `score` until the next recompute. */
  storedScore: number;
  band: HealthBand;
  contributingFactors: AccountHealthFactor[];
  computedAt: string;
  version: number;
}

/** One stage's contribution to the weighted revenue forecast. */
export interface CRMForecastStage {
  stageId: string;
  stageName: string;
  /** Win probability for the stage, 0–100. */
  probability: number;
  /** Weighted value in bigint minor units (paise), as a string. */
  weightedTotalMinor: string;
}

/** Weighted revenue forecast computed from active deals in a pipeline. */
export interface CRMForecast {
  /** Total weighted value in bigint minor units (paise), as a string. */
  totalForecastMinor: string;
  dealCount: number;
  stages: CRMForecastStage[];
}

/**
 * Money and return figures for a campaign or one of its reporting periods (P1-6).
 * Every money field is bigint minor units (paise) carried as a string, and ROI is
 * an integer basis-point string — never a float, because a percentage double
 * silently rounds crore-scale paise.
 */
export interface CRMCampaignRoiFigures {
  costMinor: string;
  revenueMinor: string;
  /** revenue - cost; negative when the campaign lost money. */
  netMinor: string;
  responses: number;
  /** Basis points (1 bp = 0.01%), or null when no spend was recorded. */
  roiBasisPoints: string | null;
  /** Basis points rendered to two decimals, or null when ROI is undefined. */
  roiPercent: string | null;
  costPerResponseMinor: string | null;
}

/** One campaign's aggregated performance across all its reporting periods. */
export interface CRMCampaignRoiSummaryRow extends CRMCampaignRoiFigures {
  campaignId: string;
  currency: string;
  /** How many reporting periods were folded into these figures. */
  periods: number;
}

/** One reporting period's performance within a campaign. */
export interface CRMCampaignRoiPeriod extends CRMCampaignRoiFigures {
  periodStart: string | null;
  /** Null for an open-ended period that is still running. */
  periodEnd: string | null;
}

/** A campaign's totals plus its per-period breakdown. */
export interface CRMCampaignRoi extends CRMCampaignRoiFigures {
  campaignId: string;
  currency: string;
  periods: CRMCampaignRoiPeriod[];
}

/**
 * One entry in a golden profile's append-only provenance trail (P1-14).
 * `attributes` is optional: a trail written before attribute-level provenance
 * existed names no keys, and the Customer 360 view reads those as unattributed
 * rather than crediting them to the most recent contributor.
 */
export interface CDPProfileLineageEntry {
  source: string;
  sourceId: string;
  /** ISO 8601, stamped by the service. */
  timestamp: string;
  attributes?: string[];
}

/** A CDP golden profile as returned by cdp-service. */
export interface CDPProfile {
  id: string;
  profileType: string;
  attributes: Record<string, unknown>;
  sourceLineage: CDPProfileLineageEntry[];
  mergedFromIds: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A resolved identifier linked to a golden profile. Values are stored hashed. */
export interface CDPIdentityLink {
  id: string;
  profileId: string;
  identifierType: string;
  /** Match confidence, 0-100. */
  confidence: number;
  createdAt: string;
}

/** One interaction event on a profile's timeline. */
export interface CDPProfileEvent {
  id: string;
  profileId: string;
  eventType: string;
  occurredAt: string;
}

/** Admin view of a public website lead-capture form (P1-7 / LM-002). */
export interface CRMLeadCaptureForm {
  id: string;
  tenantId: string;
  formKey: string;
  name: string;
  enabled: boolean;
  requireConsent: boolean;
  allowedOrigins: string[];
  defaultLeadSource: string | null;
  campaignId: string | null;
  maxPerMinute: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** P2-8 control tower GIS cell. */
export interface CRMControlTowerRegion {
  region: string;
  dealCount: number;
  pipelineMinor: string;
}

/** P2-8 control tower exception row with drill-down href. */
export interface CRMControlTowerException {
  id: string;
  kind: "overdue_follow_up" | "dormant_account" | "aged_lead";
  label: string;
  severity: "high" | "medium";
  href: string;
  count: number;
}

export interface CRMControlTower {
  regions: CRMControlTowerRegion[];
  exceptions: CRMControlTowerException[];
  drillDown: { regionReport: string; ageingReport: string; accounts: string };
}

/** Notification A/B-MVT experiment summary (P2-9). */
export interface NotificationExperiment {
  id: string;
  name: string;
  status: string;
  winnerVariantId: string | null;
  winnerMarginPct: number | null;
  concludedAt: string | null;
}





/** A recurring subject in customer interactions, with how often it turned sour. */
export interface CRMVocTheme {
  theme: string;
  count: number;
  negativeCount: number;
}

/** Voice-of-Customer aggregate over scored interactions (P2-6). */
export interface CRMVocSummary {
  total: number;
  byPolarity: { positive: number; neutral: number; negative: number };
  /** Mean sentiment score, -100 (worst) to 100 (best). */
  averageScore: number;
  /** Percentage of interactions that were negative, 0-100. */
  negativeShare: number;
  themes: CRMVocTheme[];
  /** True when the scan hit its row cap, so the figures cover a partial window. */
  truncated: boolean;
}

export interface CRMContactSummary {
  id?: string;
  name: string;
  account: string;
  email: string;
  phone: string;
  leadStatus?: string;
  tags?: string[];
  lastActivity?: string;
  /** LQ-003 classification / segmentation. */
  temperature?: string;
  priority?: string;
  segment?: string;
  product?: string;
  region?: string;
  /** Pre-formatted expected value for display (e.g. "₹1,50,000"). */
  expectedValueDisplay?: string;
}

/** CRM account (organisation) row for the accounts list + hierarchy screens. */
export interface CRMAccountSummary {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  parentId: string | null;
  contactCount: number;
}

/** Minimal account node used for hierarchy breadcrumbs and child lists. */
export interface CRMAccountNode {
  id: string;
  name: string;
}

export interface ActivitySummary {
  id: string;
  actor: string;
  text: string;
  timeAgo: string;
}

/** Generic row for module list screens (prompt 14 expansion). */
export interface ModuleRowSummary {
  id: string;
  label: string;
  sublabel?: string;
  status?: string;
  meta?: string;
}

export interface PurchaseOrderSummary {
  id: string;
  vendor: string;
  amountDisplay: string;
  status: 'Pending' | 'Approved' | 'Review' | 'Rejected';
}

export interface VendorSummary {
  name: string;
  category: string;
  ratingDisplay: string;
}

export interface ApprovalSummary {
  id: string;
  referenceId: string;
  owner: string;
  dueDisplay: string;
}

export interface EmployeeSummary {
  id: string;
  employeeNo?: string;
  name: string;
  department: string;
  status: string;
}

export interface AttendanceSummary {
  date: string;
  presentCount: number;
  absentCount: number;
  lateCount: number;
}

export interface LeaveRequestSummary {
  id: string;
  employee: string;
  leaveType: string;
  status: 'Pending' | 'Approved' | 'Rejected';
}

export interface PayrollRunSummary {
  month: string;
  grossDisplay: string;
  status: 'In Processing' | 'Completed' | 'Failed';
}

export interface AccountSummary {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  currency: string;
  balanceDisplay: string;
  status: 'active' | 'inactive';
}

export interface AuditRowSummary {
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure';
}

export type HelpdeskTicketPriority = 'Low' | 'Medium' | 'High' | 'Critical';
export type HelpdeskTicketStatus = 'Open' | 'In Progress' | 'Resolved' | 'Closed';

/** Citizen-facing ticket row (citizen-service). */
export interface HelpdeskTicketSummary {
  id: string;
  subject: string;
  priority: HelpdeskTicketPriority;
  status: HelpdeskTicketStatus;
  dueDate?: string;
  escalatedAt?: string;
  slaStatus?: "within_sla" | "at_risk" | "breached";
  assignee?: string;
}

/** Internal ops ticket row (helpdesk-service); same wire shape as HelpdeskTicketSummary. */
export type InternalHelpdeskTicketSummary = HelpdeskTicketSummary;

export interface SLAQueueSummary {
  queue: string;
  targetDisplay: string;
  breachedCount: number;
}

export interface PluginSummary {
  name: string;
  status: 'enabled' | 'disabled';
}

export interface ThemeTokenSummary {
  key: string;
  value: string;
}

export interface PaymentSummary {
  referenceId: string;
  beneficiary: string;
  amountDisplay: string;
  status: 'Queued' | 'Released' | 'Pending Approval' | 'Failed';
}

export interface InstallerStageSummary {
  name: string;
}

export interface TenantUserSummary {
  name: string;
  role: string;
  status: 'Active' | 'Suspended' | 'Invited';
}

export interface RoleAssignmentSummary {
  key: string;
  assignedUsers: number;
}

export interface TenantSettingSummary {
  name: string;
}

export type FinanceDashboard = {
  budgetUtilisationPct: number;
  pendingSanctions: number;
  paymentsThisMonth: number;
  totalExpenditure: number;
};

export type BudgetSummary = {
  id: string;
  majorHead: string;
  subHead?: string;
  sanctionedAmount: number;
  releasedAmount: number;
  expenditure: number;
  balance: number;
  status: string;
  financialYear: string;
};

export type SanctionSummary = {
  id: string;
  sanctionNo: string;
  subject: string;
  amount: number;
  sanctionedBy: string;
  date: string;
  status: "approved" | "pending" | "rejected";
  majorHead: string;
};

export type SanctionDetail = SanctionSummary & {
  lineItems: Array<{ description: string; amount: number; head: string }>;
  remarks?: string;
  approvalTrail: Array<{ actor: string; action: string; timestamp: string }>;
};

export type BillSummary = {
  id: string;
  billNo: string;
  vendor: string;
  amount: number;        // minor units (paise)
  amountDisplay?: string; // pre-formatted display string e.g. "₹47,500.00"
  submittedDate: string;
  dueDate?: string;
  status: "pending" | "approved" | "paid" | "rejected" | "under_review";
  poRef?: string;
  threeWayMatch: "matched" | "partial" | "unmatched" | "na";
};

export type BillDetail = BillSummary & {
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; amount: number; taxCode?: string }>;
  grnRef?: string;
  invoiceNo?: string;
  paymentRef?: string;
};

export type AdvanceSummary = {
  id: string;
  advanceNo: string;
  beneficiary: string;
  type: "employee" | "vendor" | "other";
  amount: number;
  disbursedDate: string;
  dueDate?: string;
  adjustedAmount: number;
  balance: number;
  status: "active" | "adjusted" | "overdue" | "closed";
};

export type UCSummary = {
  id: string;
  ucNo: string;
  grantRef?: string;
  grantee: string;
  amount: number;
  periodFrom: string;
  periodTo: string;
  submittedDate?: string;
  status: "pending" | "submitted" | "verified" | "rejected";
};

export type GLEntrySummary = {
  id: string;
  voucherNo: string;
  date: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  narration?: string;
  referenceNo?: string;
  type?: "payment" | "receipt" | "journal" | "budget";
};

export type FinancialStatementSummary = {
  id: string;
  head: string;
  openingBalance: number;
  receipts: number;
  payments: number;
  closingBalance: number;
  type: "asset" | "liability" | "income" | "expenditure";
};

// HR types
export type HRDashboard = {
  headcount: number;
  headcountLastMonth: number;
  attendanceTodayPct: number;
  pendingLeaves: number;
  onLeave: number;
  payrollDue: number;
  departmentBreakdown: { name: string; count: number }[];
};

export type LeaveInboxItem = {
  id: string;
  employeeName: string;
  employeeNo: string;
  departmentName: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  fromDate: string;
  toDate: string;
  daysApplied: number;
  status: string;
};

export type AttendanceSummaryItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: "present" | "absent" | "half_day" | "on_leave" | "holiday";
  hoursWorked?: number;
};

export type AttendanceRegularisation = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  reason: string;
  requestedStatus: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
};

export type LeaveRequestDetail = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveType: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason?: string;
  approver?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  appliedAt: string;
};

export type PayrollRunDetail = {
  id: string;
  runDate: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  deductions: number;
  status: "draft" | "processing" | "completed" | "paid" | "disbursed" | "failed";
};

export type PayrollRunFullDetail = PayrollRunDetail & {
  salarySlips: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    gross: number;
    deductions: number;
    net: number;
    status: string;
  }>;
};

export type SalarySlipSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  payPeriod: string;
  gross: number;
  deductions: number;
  net: number;
  status: "draft" | "finalized" | "paid" | "computed";
};

export type JobOpeningSummary = {
  id: string;
  jobTitle: string;
  department: string;
  vacancies: number;
  applicationDeadline?: string;
  status: "open" | "closed" | "on_hold";
  applicationsReceived: number;
  postedDate: string;
};

export type AppraisalSummary = {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  appraisalPeriod: string;
  rating?: number;
  status: "pending" | "in_review" | "completed";
  reviewerName?: string;
};

export type TrainingProgramSummary = {
  id: string;
  title: string;
  category: string;
  trainerName?: string;
  startDate: string;
  endDate: string;
  venue?: string;
  enrolledCount: number;
  maxCapacity?: number;
  status: "upcoming" | "ongoing" | "completed" | "cancelled";
};

export type OrgChartNode = {
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null;
  children?: OrgChartNode[];
};

export type EmployeeDetail = {
  id: string;
  employeeId: string;
  name: string;
  email?: string;
  phone?: string;
  department: string;
  designation: string;
  grade?: string;
  joiningDate: string;
  confirmationDate?: string;
  status: string;
  reportingTo?: string;
  postingLocation?: string;
};

// Procurement types
export type ProcurementDashboard = {
  pendingIndents: number;
  activePOs: number;
  grnsThisMonth: number;
  contractRenewalsDue: number;
};

export type IndentSummary = {
  id: string;
  indentNo: string;
  requestedBy: string;
  department: string;
  itemCount: number;
  estimatedAmount: number;
  requestDate: string;
  requiredByDate?: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "converted_to_po";
};

export type IndentDetail = IndentSummary & {
  lineItems: Array<{
    itemCode: string;
    itemName: string;
    quantity: number;
    unit: string;
    estimatedUnitPrice: number;
    totalPrice: number;
  }>;
  approvalTrail: Array<{
    actor: string;
    action: string;
    timestamp: string;
    remarks?: string;
  }>;
};

export type VendorDetail = {
  id: string;
  vendorCode: string;
  name: string;
  gstin?: string;
  panNo?: string;
  category: string;
  empanelmentStatus: "empanelled" | "provisional" | "blacklisted" | "not_empanelled";
  rating?: number;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  kycStatus?: string;
  kycVerifiedAt?: string | null;
};

export type RFQSummary = {
  id: string;
  rfqNo: string;
  title: string;
  indentRef?: string;
  vendorsInvited: number;
  responsesReceived: number;
  closingDate: string;
  status: "draft" | "issued" | "closed" | "cancelled" | "awarded";
};

export type RFQDetail = RFQSummary & {
  description?: string;
  lineItems: Array<{ itemName: string; quantity: number; unit: string }>;
  responses: Array<{
    vendorId: string;
    vendorName: string;
    totalAmount: number;
    submittedAt: string;
    status: string;
  }>;
};

export type GRNStatus =
  | "pending"
  | "draft"
  | "under_inspection"
  | "received"
  | "quality_check"
  | "accepted"
  | "partially_rejected"
  | "rejected"
  | "dispatched";

export type GRNSummary = {
  id: string;
  grnNo: string;
  poRef: string;
  vendor: string;
  receivedDate: string;
  receivedBy: string;
  itemCount: number;
  totalValue: number;
  status: GRNStatus;
  threeWayMatch?: boolean;
};

export type GRNDetail = GRNSummary & {
  vendorId?: string;
  notes?: string;
  threeWayMatch: boolean;
  items: Array<{
    id?: string;
    poItemRef: string;
    itemCode: string;
    orderedQty: number;
    receivedQty: number;
    acceptedQty: number;
    unit: string;
  }>;
  inspection: {
    inspectorId: string;
    inspectionDate: string;
    result: string;
    remarks?: string;
  } | null;
};

/** Store Receipt Note (SRN) — GFR Rule 149 signed acceptance gating payment on a GRN. */
export type SrnDetail = {
  id: string;
  grnId: string;
  storeOfficerId: string;
  receivedAt: string | null;
  remarks?: string;
  status: "draft" | "signed";
  createdAt: string;
};

/** Goods return awaiting/undergoing QC — inventory-service (SVC-053). */
export type GoodsReturnDetail = {
  id: string;
  originalIssueId: string;
  itemId: string;
  storeId: string;
  qty: number;
  reason: string;
  qcStatus: "pending" | "passed" | "failed" | "conditional";
  qcInspectedBy: string | null;
  qcInspectedAt: string | null;
  qcNotes: string | null;
  disposition: "pending" | "restock" | "quarantine" | "scrap";
  createdAt: string;
};

export type TenderSummary = {
  id: string;
  tenderNo: string;
  title: string;
  type: "open" | "limited" | "single_source" | "gem";
  estimatedValue: number;
  publishDate?: string;
  bidClosingDate: string;
  openingDate?: string;
  status: "draft" | "published" | "evaluation" | "awarded" | "cancelled";
  bidsReceived: number;
};

export type TenderDetail = TenderSummary & {
  scope?: string;
  eligibilityCriteria?: string;
  bids: Array<{
    vendorId: string;
    vendorName: string;
    bidAmount: number;
    technicalScore?: number;
    financialScore?: number;
    status: string;
  }>;
};

export type PurchaseOrderListItem = {
  id: string;
  poNo: string;
  vendor: string;
  amount: number;
  orderDate: string;
  deliveryDate?: string;
  grnStatus?: string;
  status: "draft" | "pending" | "approved" | "dispatched" | "partial_grn" | "fully_received" | "cancelled" | "gem_placed";
};

export type PODetail = {
  id: string;
  poNo: string;
  vendor: string;
  vendorId?: string;
  orderDate: string;
  deliveryDate?: string;
  totalAmount: number;
  status: "draft" | "pending" | "approved" | "dispatched" | "partial_grn" | "fully_received" | "cancelled" | "gem_placed";
  lineItems: Array<{
    itemCode: string;
    itemName: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    grnQty: number;
  }>;
};

// CRM + Helpdesk + Citizen types

export type CRMDashboard = {
  totalContacts: number;
  openDeals: number;
  activitiesToday: number;
  pipelineValue: number;
};

export type DealSummary = {
  id: string;
  dealName: string;
  contactId?: string;
  contactName?: string;
  stage: "prospecting" | "qualification" | "proposal" | "negotiation" | "closed_won" | "closed_lost";
  amount: number;
  owner: string;
  closeDate?: string;
  probability: number;
  status: "open" | "won" | "lost";
};

export type ContactDetail = {
  id: string;
  name: string;
  organization?: string;
  email?: string;
  phone?: string;
  designation?: string;
  city?: string;
  leadStatus?: string;
  marketingConsent?: boolean;
  lastActivityDate?: string;
  /** LQ-003 classification / segmentation. */
  temperature?: string;
  priority?: string;
  segment?: string;
  product?: string;
  region?: string;
  expectedValueMinor?: string;
  expectedValueDisplay?: string;
  tags: string[];
  deals: Array<{ id: string; dealName: string; stage: string; amount: number }>;
  activityTimeline: Array<{
    id: string;
    type: string;
    subject: string;
    dueDate?: string;
    completedAt?: string;
    status: string;
  }>;
};

export type CRMActivityEntry = {
  id: string;
  type: "call" | "meeting" | "email" | "task" | "note";
  subject: string;
  relatedTo?: string;
  relatedType?: "contact" | "deal" | "other";
  dueDate?: string;
  completedAt?: string;
  owner: string;
  status: "open" | "overdue" | "completed" | "cancelled";
};

export type TicketDetail = {
  id: string;
  ticketNo: string;
  subject: string;
  description?: string;
  requesterName: string;
  requesterEmail?: string;
  assignedTo?: string;
  priority: "low" | "medium" | "high" | "critical";
  slaStatus: "within_sla" | "due_soon" | "breached";
  status: "open" | "in_progress" | "pending" | "resolved" | "closed";
  channel?: "web" | "email" | "phone" | "walk_in";
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  comments: Array<{
    id: string;
    author: string;
    content: string;
    createdAt: string;
    isInternal: boolean;
  }>;
};

export type TicketAnalytics = {
  totalTickets: number;
  openTickets: number;
  resolvedThisMonth: number;
  slaBreachedCount: number;
  avgResolutionHours: number;
  byPriority: Array<{ priority: string; count: number; pct: number }>;
  byChannel: Array<{ channel: string; count: number; pct: number }>;
};

export type CitizenRequestSummary = {
  id: string;
  requestNo: string;
  serviceType: string;
  citizenName: string;
  citizenPhone?: string;
  submittedAt: string;
  expectedResolutionDate?: string;
  status: "submitted" | "under_review" | "in_progress" | "resolved" | "rejected";
  remarks?: string;
};

export type RTISummary = {
  id: string;
  rtiNo: string;
  applicantName: string;
  subject: string;
  publicAuthority?: string;
  filedDate: string;
  deadlineDate?: string;
  transferredTo?: string;
  status: "received" | "forwarded" | "under_review" | "replied" | "appeal" | "closed";
  isFirstAppeal: boolean;
};

export type ProjectsDashboard = {
  totalProjects: number;
  onTrackPct: number;
  delayed: number;
  totalOutlay: number;
};

export type ProjectSummary = {
  id: string;
  projectCode: string;
  name: string;
  scheme?: string;
  department?: string;
  startDate: string;
  expectedEndDate?: string;
  totalBudget: number;
  expenditure: number;
  completionPct: number;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled" | "delayed";
};

export type ProjectDetail = ProjectSummary & {
  description?: string;
  milestones: Array<{
    id: string;
    title: string;
    dueDate: string;
    completedDate?: string;
    status: "pending" | "completed" | "delayed";
  }>;
  fundReleases: Array<{
    id: string;
    releaseDate: string;
    amount: number;
    remarks?: string;
  }>;
};

export type MilestoneSummary = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  dueDate: string;
  completedDate?: string;
  status: "pending" | "completed" | "delayed";
  remarks?: string;
};

export type FundReleaseSummary = {
  id: string;
  releaseNo: string;
  projectId: string;
  projectName: string;
  amount: number;
  releaseDate: string;
  releasedBy?: string;
  installmentNo?: number;
  remarks?: string;
  status: "sanctioned" | "released" | "utilized";
};

export type SchemeSummary = {
  id: string;
  schemeCode: string;
  name: string;
  ministry?: string;
  department?: string;
  fundingType: "central" | "state" | "centrally_sponsored" | "external";
  totalAllocation: number;
  releasedAmount: number;
  projectCount: number;
  status: "active" | "completed" | "discontinued";
};

export type GrantsDashboard = {
  totalGrants: number;
  disbursedAmount: number;
  pendingUCs: number;
  totalGrantees: number;
};

export type GrantSummary = {
  id: string;
  grantNo: string;
  title: string;
  grantor?: string;
  granteeId?: string;
  granteeName?: string;
  totalAmount: number;
  disbursedAmount: number;
  pendingAmount: number;
  sanctionDate: string;
  purpose?: string;
  status: "active" | "completed" | "suspended" | "cancelled";
};

export type GrantDetail = GrantSummary & {
  conditions?: string;
  installments: Array<{
    id: string;
    installmentNo: number;
    amount: number;
    scheduledDate: string;
    releasedDate?: string;
    status: "pending" | "released" | "utilized";
  }>;
  ucs: Array<{
    id: string;
    ucNo: string;
    amount: number;
    period: string;
    status: string;
  }>;
};

export type GranteeSummary = {
  id: string;
  granteeCode: string;
  name: string;
  type: "ngo" | "government" | "institution" | "individual";
  registrationNo?: string;
  panNo?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  activeGrants: number;
  totalGrantsReceived: number;
  ucCompliancePct: number;
};

export type GrantInstallmentSummary = {
  id: string;
  grantId: string;
  grantNo: string;
  granteeName: string;
  installmentNo: number;
  amount: number;
  scheduledDate: string;
  releasedDate?: string;
  status: "pending" | "released" | "utilized";
};

export type GrantRelease = {
  id: string;
  releaseNo: string;
  grantId: string;
  grantNo: string;
  granteeName: string;
  amount: number;
  releaseDate: string;
  bankRef?: string;
  status: "pending" | "processed" | "credited";
};

export type GrantUtilization = {
  id: string;
  ucNo: string;
  grantId: string;
  grantNo: string;
  granteeName: string;
  amount: number;
  periodFrom: string;
  periodTo: string;
  submittedDate?: string;
  verifiedDate?: string;
  status: "pending" | "submitted" | "verified" | "rejected";
};

// Establishment types
export type EstabDashboard = {
  filesPending: number;
  meetingsToday: number;
  vehiclesInUse: number;
  complianceItemsDue: number;
  slaBreached: number;
  dakPending: number;
  avgPendencyDays: number;
};

export type EstabFileSummary = {
  id: string;
  fileNo: string;
  subject: string;
  classification: "top_secret" | "secret" | "confidential" | "restricted" | "unclassified";
  department?: string;
  createdBy: string;
  createdDate: string;
  currentHolder?: string;
  status: "active" | "pending" | "archived" | "disposed";
  dueDate?: string;
  tags: string[];
};

export type EstabFileDetail = EstabFileSummary & {
  noteSheets: Array<{
    id: string;
    author: string;
    content: string;
    timestamp: string;
    type: "note" | "order" | "remark";
  }>;
  dispatchHistory: Array<{
    id: string;
    dispatchedTo: string;
    dispatchedBy: string;
    timestamp: string;
    remarks?: string;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    fileType: string;
    size: number;
    uploadedAt: string;
  }>;
};

export type MeetingSummary = {
  id: string;
  meetingNo: string;
  title: string;
  type: "cabinet" | "committee" | "department" | "review" | "external";
  scheduledDate: string;
  scheduledTime?: string;
  venue?: string;
  chairperson?: string;
  attendeesCount: number;
  agendaItemsCount: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "postponed";
};

export type MeetingDetail = MeetingSummary & {
  agenda: Array<{
    id: string;
    itemNo: number;
    title: string;
    description?: string;
    decision?: string;
  }>;
  minutes?: string;
  attendees: Array<{
    name: string;
    designation?: string;
    present: boolean;
  }>;
  actionPoints: Array<{
    id: string;
    description: string;
    assignedTo: string;
    dueDate?: string;
    status: "pending" | "completed";
  }>;
};

export type VehicleSummary = {
  id: string;
  vehicleNo: string;
  make: string;
  model: string;
  type: "sedan" | "suv" | "bus" | "van" | "truck" | "ambulance" | "other";
  assignedTo?: string;
  driverName?: string;
  fuelType: "petrol" | "diesel" | "cng" | "electric";
  status: "available" | "in_use" | "maintenance" | "reserved" | "disposed";
  lastServiceDate?: string;
  nextServiceDue?: string;
  odometerKm: number;
};

export type GuesthouseBookingSummary = {
  id: string;
  bookingNo: string;
  guestName: string;
  designation?: string;
  department?: string;
  checkInDate: string;
  checkOutDate: string;
  roomType?: string;
  roomNo?: string;
  purposeOfVisit?: string;
  status: "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled";
};

export type ComplianceSummary = {
  id: string;
  complianceCode: string;
  title: string;
  category: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "one_time";
  dueDate: string;
  assignedTo?: string;
  status: "pending" | "complied" | "overdue" | "not_applicable";
  lastCompliedDate?: string;
  remarks?: string;
};

export type LibraryBookSummary = {
  id: string;
  accessionNo: string;
  title: string;
  author?: string;
  isbn?: string;
  category?: string;
  copiesTotal: number;
  copiesAvailable: number;
  status: "available" | "unavailable";
};

export type LibraryIssueSummary = {
  id: string;
  bookId: string;
  bookTitle?: string;
  borrowerRef: string;
  issuedAt: string;
  dueAt: string;
  returnedAt?: string;
  status: "issued" | "returned" | "overdue";
};

export type AssetDashboard = {
  totalAssets: number;
  fixedAssets?: number;
  infraAssets?: number;
  underMaintenance: number;
  dueForDisposal: number;
  taggedAssets?: number;
  netBlock: number;
  recentGrnAssets?: Array<{ id: string; code: string; name: string; acquisitionDate: string; acquisitionCost: number }>;
};

export type AssetSummary = {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  type: "fixed" | "infra" | "movable" | "it" | "vehicle" | "other";
  purchaseDate: string;
  purchaseCost: number;
  currentValue: number;
  location?: string;
  assignedTo?: string;
  department?: string;
  status: "active" | "in_use" | "maintenance" | "disposed" | "condemned";
  condition?: "excellent" | "good" | "fair" | "poor";
};

export type AssetDetail = AssetSummary & {
  description?: string;
  serialNo?: string;
  warrantyExpiry?: string;
  depreciationSchedule: Array<{
    year: number;
    openingValue: number;
    depreciationAmount: number;
    closingValue: number;
    rate: number;
  }>;
  maintenanceHistory: Array<{
    id: string;
    date: string;
    type: string;
    description: string;
    cost: number;
    vendor?: string;
  }>;
};

export type MaintenanceSummary = {
  id: string;
  assetId: string;
  assetCode: string;
  assetName: string;
  maintenanceType: "preventive" | "corrective" | "amc" | "breakdown";
  scheduledDate: string;
  completedDate?: string;
  vendor?: string;
  estimatedCost: number;
  actualCost: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled" | "overdue";
  remarks?: string;
};

export type StockDashboard = {
  totalSKUs: number;
  lowStockAlerts: number;
  grnsThisMonth: number;
  inventoryValue: number;
};

export type StockItemSummary = {
  id: string;
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  maxStockLevel?: number;
  unitCost: number;
  totalValue: number;
  warehouseLocation?: string;
  isLowStock: boolean;
  lastReceivedDate?: string;
  lastIssuedDate?: string;
};

export type StockItemDetail = StockItemSummary & {
  description?: string;
  hsnCode?: string;
  gstRate?: number;
  stockLedger: Array<{
    id: string;
    date: string;
    type: "receipt" | "issue" | "transfer" | "adjustment";
    quantity: number;
    unitCost: number;
    totalValue: number;
    referenceNo?: string;
    party?: string;
    balance: number;
  }>;
};

export type StockLedgerEntry = {
  id: string;
  itemCode: string;
  itemName: string;
  date: string;
  type: "receipt" | "issue" | "transfer" | "adjustment";
  quantity: number;
  unitCost: number;
  totalValue: number;
  referenceNo?: string;
  party?: string;
  warehouseLocation?: string;
  balance: number;
};

/**
 * Cycle count — physical vs. system on-hand quantity comparison, with
 * auto-adjust threshold and a supervisor approve/reject workflow above it.
 * Mirrors `services/inventory-service/src/modules/cycle-count/schema.ts`.
 */
export type CycleCountStatus = "pending" | "auto_posted" | "pending_approval" | "approved" | "rejected";

export type CycleCountDetail = {
  id: string;
  itemId: string;
  warehouseId: string;
  systemQty: number;
  physicalQty: number;
  variance: number;
  absVariance: number;
  autoAdjustThreshold: number;
  reasonCode: string;
  status: CycleCountStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  countedAt: string;
  createdAt: string;
  version: number;
};

// ── Audit types ───────────────────────────────────────────────────────────────

export type AuditDashboard = {
  openObservations: number;
  riskRegisterItems: number;
  cagParas: number;
  compliancePct: number;
};

export type AuditObservationSummary = {
  id: string;
  observationNo: string;
  title: string;
  type: "internal" | "cag" | "statutory" | "concurrent";
  severity: "critical" | "major" | "minor" | "observation";
  department?: string;
  auditPeriod?: string;
  raisedDate: string;
  dueDate?: string;
  status: "open" | "replied" | "partially_closed" | "closed" | "compliance_pending";
  para?: string;
  amount?: number;
};

export type AuditObservationDetail = AuditObservationSummary & {
  description?: string;
  amount?: number;
  recommendations?: string;
  replies: Array<{
    id: string;
    repliedBy: string;
    content: string;
    repliedAt: string;
    acceptedByAuditor?: boolean;
  }>;
  closureDetails?: string;
};

export type RiskSummary = {
  id: string;
  riskCode: string;
  title: string;
  category: "financial" | "operational" | "compliance" | "reputational" | "strategic" | "it";
  likelihood: "rare" | "unlikely" | "possible" | "likely" | "almost_certain";
  impact: "negligible" | "minor" | "moderate" | "major" | "catastrophic";
  riskScore: number;
  owner?: string;
  mitigationStatus: "not_started" | "in_progress" | "implemented" | "accepted";
  reviewDate?: string;
  status: "open" | "mitigated" | "closed" | "escalated";
};

export type AuditPlanItem = {
  id: string;
  auditUnit: string;
  department: string;
  type: "routine" | "special" | "compliance" | "performance";
  plannedFrom: string;
  plannedTo: string;
  auditorTeam?: string;
  status: "planned" | "in_progress" | "completed" | "deferred";
};

export type AuditComplianceItem = {
  id: string;
  lawOrRule: string;
  section?: string;
  requirement: string;
  frequency: string;
  dueDate: string;
  department?: string;
  status: "complied" | "pending" | "overdue" | "na";
  evidence?: string;
};

export type AuditExportJob = {
  id: string;
  jobType: string;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  format: "pdf" | "xlsx" | "csv";
  status: "queued" | "processing" | "completed" | "failed";
  downloadUrl?: string;
};

export type CagParaSummary = {
  id: string;
  reportYear: string;
  paraNo: string;
  department: string;
  totalParas: number;
  settled: number;
  pending: number;
  status: "under_review" | "partially_settled" | "nearly_settled" | "settled";
};

export type VigilanceCaseSummary = {
  id: string;
  caseNo: string;
  officer: string;
  charges: string;
  inquiryStatus: "preliminary_enquiry" | "under_investigation" | "charge_sheet_issued" | "inquiry_complete";
  outcome: "pending" | "major_penalty" | "minor_penalty" | "exonerated";
};

export type InvestigationSummary = {
  id: string;
  caseId: string;
  subject: string;
  assignedTo: string;
  started: string;
  findings: string;
  status: "in_progress" | "findings_submitted" | "closed";
};

// ── Legal types ───────────────────────────────────────────────────────────────

export type LegalDashboard = {
  activeCases: number;
  hearingsThisWeek: number;
  ordersPending: number;
  opinionsDue: number;
};

export type LegalCaseSummary = {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  type: "civil" | "criminal" | "arbitration" | "tribunal" | "writ" | "appeal" | "other";
  filedDate: string;
  department?: string;
  petitioner?: string;
  respondent?: string;
  advocateName?: string;
  nextHearingDate?: string;
  status: "active" | "disposed" | "stayed" | "transferred" | "dismissed" | "settled" | "pending" | "appealed";
};

export type LegalCaseDetail = LegalCaseSummary & {
  description?: string;
  hearings: Array<{
    id: string;
    date: string;
    court: string;
    purpose?: string;
    outcome?: string;
    nextDate?: string;
  }>;
  orders: Array<{
    id: string;
    date: string;
    orderNo?: string;
    summary: string;
    complianceRequired: boolean;
    complianceDeadline?: string;
    status: "pending" | "complied" | "appealed";
  }>;
};

export type HearingSummary = {
  id: string;
  caseId: string;
  caseNo: string;
  caseTitle: string;
  court: string;
  date: string;
  time?: string;
  purpose?: string;
  outcome?: string;
  nextDate?: string;
  status: "scheduled" | "completed" | "adjourned" | "cancelled";
};

export type CourtOrderSummary = {
  id: string;
  caseId: string;
  caseNo: string;
  court: string;
  orderDate: string;
  orderNo?: string;
  summary: string;
  complianceRequired: boolean;
  complianceDeadline?: string;
  department?: string;
  status: "pending" | "complied" | "appealed" | "stayed";
};

export type LegalOpinionSummary = {
  id: string;
  opinionNo: string;
  subject: string;
  requestedBy: string;
  requestDate: string;
  dueDate?: string;
  advisorName?: string;
  status: "pending" | "draft" | "issued" | "revised";
  issuedDate?: string;
};

// ── Admin / Platform types ────────────────────────────────────────────────────

export type UserSummary = {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt?: string;
  status: string;
  createdAt: string;
};

export type UserDetail = {
  id: string;
  email: string;
  name?: string;
  roles: string[];
  mfaEnabled: boolean;
  lastLoginAt?: string;
  status: "active" | "inactive" | "suspended" | "pending_verification";
  createdAt: string;
  sessions: Array<{
    id: string;
    ipAddress?: string;
    createdAt: string;
    lastActiveAt: string;
    status: string;
  }>;
};

export type RoleDetail = {
  id: string;
  name: string;
  description?: string;
  isSystemRole: boolean;
  permissions: Array<{
    module: string;
    action: string;
    resource?: string;
    allowed: boolean;
  }>;
  userCount: number;
  createdAt: string;
};

export type SessionSummary = {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  mfaVerified: boolean;
  status: "active" | "expired" | "revoked";
};

export type BreakglassSummary = {
  id: string;
  actor: string;
  actorEmail: string;
  reason: string;
  resourceAccessed?: string;
  startedAt: string;
  endedAt?: string;
  approvedBy?: string;
  status: "active" | "ended" | "auto_expired";
};

export type APIKeySummary = {
  id: string;
  keyName: string;
  keyPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  scopes: string[];
  status: "active" | "expired" | "revoked";
};

export type InstallStepSummary = {
  id: string;
  stepNo: number;
  title: string;
  description?: string;
  isRequired: boolean;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  completedAt?: string;
  errorMessage?: string;
};

export type NotificationPrefSummary = {
  id: string;
  eventType: string;
  module: string;
  label: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  inAppEnabled: boolean;
  webhookEnabled: boolean;
};

export type SubscriptionSummary = {
  id: string;
  plan: string;
  status: "active" | "past_due" | "cancelled" | "trial";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  userLimit?: number;
  activeUsers: number;
  moduleAccess: string[];
  billingEmail?: string;
  amount?: number;
  currency: string;
};

export type TenantModule = {
  moduleKey: string;
  moduleName: string;
  enabled: boolean;
  enabledAt?: string;
};

export type TenantAuditEvent = {
  id: string;
  actor: string;
  action: string;
  resource?: string;
  outcome: string;
  timestamp: string;
  ipAddress?: string;
};

// ── Analytics / Reports types ─────────────────────────────────────────────────

export type ReportDashboardItem = {
  id: string;
  title: string;
  module: string;
  value?: number;
  unit?: string;
  changePct?: number;
  changeDirection?: "up" | "down" | "neutral";
};

export type ReportDashboard = {
  kpis: ReportDashboardItem[];
  summary?: string;
};

export type ReportJobSummary = {
  id: string;
  reportName: string;
  module: string;
  requestedBy: string;
  requestedAt: string;
  completedAt?: string;
  format: "pdf" | "xlsx" | "csv" | "html";
  status: "queued" | "running" | "completed" | "failed";
  downloadUrl?: string;
  rowCount?: number;
};

export type ReportJobDetail = ReportJobSummary & {
  parameters?: Record<string, string>;
  columns: string[];
  rows: Record<string, string>[];
  totalCount: number;
};

export type KPISummary = {
  id: string;
  kpiName: string;
  module: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  achievementPct: number;
  period: string;
  trend: "up" | "down" | "stable";
  status: "on_track" | "at_risk" | "off_track";
};

export type MISSummary = {
  module: string;
  metrics: Array<{
    label: string;
    value: string;
    unit?: string;
    change?: string;
  }>;
};

export type KnowledgeDocSummary = {
  id: string;
  title: string;
  category: string;
  author?: string;
  createdAt: string;
  updatedAt?: string;
  tags: string[];
  status: "draft" | "under_review" | "approved" | "archived";
  accessLevel: "public" | "internal" | "restricted" | "confidential";
  fileType?: string;
  fileSize?: number;
  version: string;
};

export type KnowledgeRecord = {
  id: string;
  recordNo: string;
  title: string;
  type: "file" | "correspondence" | "register" | "other";
  department?: string;
  createdDate: string;
  retentionPeriod?: string;
  disposalDueDate?: string;
  status: "active" | "inactive" | "disposed" | "transferred";
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  module: string;
  eventType: string;
  recipient: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  status: "sent" | "pending" | "failed" | "read";
  createdAt: string;
  readAt?: string;
};

export type NotificationDelivery = {
  id: string;
  notificationId: string;
  notificationTitle: string;
  recipient: string;
  channel: "email" | "sms" | "in_app" | "webhook";
  attemptCount: number;
  deliveredAt?: string;
  failureReason?: string;
  status: "pending" | "delivered" | "failed" | "bounced";
};


// ── Payroll extended types ────────────────────────────────────────────────────

export type PayrollStructure = {
  id: string;
  name: string;
  description?: string;
  components: Array<{
    name: string;
    type: "earning" | "deduction";
    calculationMethod: "fixed" | "percentage" | "formula";
    amount?: number;
    percentage?: number;
    formula?: string;
  }>;
  isDefault: boolean;
  status: "active" | "inactive";
};

export type TaxDeclaration = {
  id: string;
  employeeId: string;
  employeeName: string;
  financialYear: string;
  regime: "old" | "new";
  totalDeclared: number;
  totalVerified: number;
  status: "draft" | "submitted" | "verified" | "locked";
  submittedAt?: string;
};

export type PensionerSummary = {
  id: string;
  ppoNo: string;
  fullName: string;
  basicPensionMinor: number;
  status: "active" | "suspended" | "ceased" | "commuted";
  ddoCode: string;
  bankAccount?: string;
  retirementDate?: string;
};
