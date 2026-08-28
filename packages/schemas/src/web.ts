import { z } from "zod";
import { paginatedSchema } from "./common.js";
import { zMoneyMinorString } from "./money.js";

export const auditRowSchema = z.object({
  actor: z.string(),
  action: z.string(),
  resource: z.string(),
  outcome: z.enum(["success", "failure"]),
});

export const metricCardSchema = z.object({
  label: z.string(),
  value: z.string(),
  note: z.string().optional(),
});

export const helpdeskTicketSchema = z.object({
  id: z.string(),
  subject: z.string(),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  status: z.enum(["Open", "In Progress", "Resolved", "Closed"]),
  dueDate: z.string().optional(),
  escalatedAt: z.string().optional(),
  slaStatus: z.enum(["within_sla", "at_risk", "breached"]).optional(),
  assignee: z.string().optional(),
});

export const slaQueueSchema = z.object({
  queue: z.string(),
  targetDisplay: z.string(),
  breachedCount: z.number().int().nonnegative(),
});

export const paymentSummarySchema = z.object({
  // Backend row id (UUID). Optional so partial/legacy payloads still satisfy
  // the schema; the real query (payments/queries.ts's listPayments) always
  // sets it. Without this field, .parse() silently stripped `id` off every
  // response, leaving the frontend's payment-detail link dead even though
  // PaymentsTable.tsx already reads `p.id` to build it.
  id: z.string().optional(),
  referenceId: z.string(),
  beneficiary: z.string(),
  amountDisplay: z.string(),
  status: z.enum(["Queued", "Released", "Pending Approval", "Failed"]),
});

export const employeeSummarySchema = z.object({
  id: z.string(),
  employeeNo: z.string().optional(),
  name: z.string(),
  department: z.string(),
  employeeType: z.string().optional(),
  status: z.string(),
});

export const leaveRequestSchema = z.object({
  id: z.string(),
  employee: z.string(),
  leaveType: z.string(),
  status: z.enum(["Pending", "Approved", "Rejected"]),
});

export const attendanceSummarySchema = z.object({
  date: z.string(),
  presentCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  lateCount: z.number().int().nonnegative(),
});

export const vendorSummarySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string(),
  category: z.string(),
  ratingDisplay: z.string(),
  gstin: z.string().optional(),
  kycStatus: z.string().optional(),
  kycVerifiedAt: z.string().nullable().optional(),
  bankAccount: z.string().optional(),
  ifsc: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  pan: z.string().optional(),
});

export const purchaseOrderSchema = z.object({
  id: z.string(),
  poNo: z.string().optional(),
  vendor: z.string(),
  amountDisplay: z.string(),
  totalMinor: z.string().optional(),
  orderDate: z.string().optional(),
  deliveryDate: z.string().nullable().optional(),
  grnStatus: z.string().optional(),
  status: z.enum(["draft", "pending", "approved", "dispatched", "partial_grn", "fully_received", "cancelled", "gem_placed"]),
});

export const approvalSummarySchema = z.object({
  id: z.string(),
  referenceId: z.string(),
  owner: z.string(),
  dueDisplay: z.string(),
});

export const tenantUserSchema = z.object({
  name: z.string(),
  role: z.string(),
  status: z.enum(["Active", "Suspended", "Invited"]),
});

export const roleAssignmentSchema = z.object({
  key: z.string(),
  assignedUsers: z.number().int().nonnegative(),
});

export const tenantSettingSchema = z.object({
  name: z.string(),
});

export const auditEventApiSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: z.string(),
  actor: z.record(z.unknown()),
  target: z.string().nullable(),
  payload: z.record(z.unknown()),
  severity: z.string(),
  occurredAt: z.string(),
});

export const auditEventsListSchema = z.array(auditEventApiSchema);
export const paymentsListSchema = paginatedSchema(paymentSummarySchema);
export const ticketsListSchema = paginatedSchema(helpdeskTicketSchema);
export const employeesListSchema = paginatedSchema(employeeSummarySchema);
export const vendorsListSchema = paginatedSchema(vendorSummarySchema);
export const payrollRunSchema = z.object({
  month: z.string(),
  grossDisplay: z.string(),
  status: z.enum(["In Processing", "Completed", "Failed"]),
});

export const dataListSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item) });

export const metricsListResponseSchema = dataListSchema(metricCardSchema);
export const slaListResponseSchema = dataListSchema(slaQueueSchema);
export const leaveListResponseSchema = dataListSchema(leaveRequestSchema);
export const payrollRunsResponseSchema = dataListSchema(payrollRunSchema);
export const posListResponseSchema = dataListSchema(purchaseOrderSchema);
export const vendorListResponseSchema = dataListSchema(vendorSummarySchema);
export const approvalsListResponseSchema = dataListSchema(approvalSummarySchema);
export const tenantModulesResponseSchema = dataListSchema(tenantSettingSchema);
export const attendanceSummaryResponseSchema = dataListSchema(attendanceSummarySchema);
export const roleListResponseSchema = z.array(z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  version: z.number().int(),
}));

export const crmContactApiSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company: z.string().nullable(),
  status: z.string(),
  // LQ-003 classification / segmentation (optional; older services omit them).
  leadStatus: z.string().nullish(),
  temperature: z.string().nullish(),
  priority: z.string().nullish(),
  segment: z.string().nullish(),
  product: z.string().nullish(),
  region: z.string().nullish(),
  expectedValueDisplay: z.string().nullish(),
});

export const crmDealApiSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  stage: z.enum(["Lead", "Proposal", "Negotiation", "Won", "Lost"]),
  valueDisplay: z.string(),
});

export const crmActivityApiSchema = z.object({
  id: z.string().uuid(),
  actorName: z.string(),
  text: z.string(),
  createdAt: z.string(),
});

export const crmAccountApiSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  industry: z.string().nullable(),
  website: z.string().nullable(),
  parentId: z.string().uuid().nullable(),
  contactCount: z.number().int(),
});

export const crmAccountHierarchyNodeSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

const chatHandoffContextSchema = z.object({
  conversationId: z.string(),
  language: z.string(),
  reasonCode: z.enum(["requested", "low_confidence", "guardrail", "agent_initiated"]),
  note: z.string().nullable(),
  summary: z.object({
    messageCount: z.number().int(),
    userMessages: z.number().int(),
    assistantMessages: z.number().int(),
    systemMessages: z.number().int(),
    totalTokens: z.number().int(),
    lastRole: z.string().nullable(),
  }),
  recentTurns: z.array(z.object({ role: z.string(), content: z.string() })),
});

const chatConversationApiSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string(),
  profileId: z.string().nullable(),
  status: z.string(),
  language: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  // Handoff fields normalise a missing key to null so a conversation written
  // before the handoff migration still parses instead of blanking the screen,
  // while the parsed value stays non-optional for consumers.
  handedOffAt: z.string().nullish().transform((v) => v ?? null),
  handoffReason: z.string().nullish().transform((v) => v ?? null),
  handoffNote: z.string().nullish().transform((v) => v ?? null),
  handoffQueue: z.string().nullish().transform((v) => v ?? null),
  handoffContext: chatHandoffContextSchema.nullish().transform((v) => v ?? null),
  version: z.number().int(),
});

export const chatConversationsListSchema = z.object({
  data: z.array(chatConversationApiSchema),
});

export const chatTranscriptSchema = z.object({
  data: z.array(z.object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    role: z.string(),
    content: z.string(),
    tokens: z.number().nullable(),
    createdAt: z.string(),
  })),
});

/**
 * Citation fields are all optional: the column is jsonb and older rows were
 * written by earlier retrievers, so a strict shape would blank the whole screen
 * over one legacy row.
 */
const copilotCitationApiSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  score: z.number().optional(),
});

const copilotTurnApiSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().nullable(),
  prompt: z.string(),
  response: z.string().nullable(),
  sourceCitations: z.array(copilotCitationApiSchema).nullable(),
  model: z.string().nullable(),
  tokens: z.number().nullable(),
  latencyMs: z.number().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});

export const copilotTurnsListSchema = z.object({
  data: z.array(copilotTurnApiSchema),
});

export const copilotTurnDetailSchema = z.object({
  data: copilotTurnApiSchema.extend({
    latencyBucket: z.enum(["fast", "normal", "slow"]).nullable().optional(),
  }),
});

const healthBandSchema = z.enum(["critical", "at_risk", "healthy", "thriving"]);

export const accountHealthEntryApiSchema = z.object({
  accountId: z.string().uuid(),
  score: z.number(),
  band: healthBandSchema,
  computedAt: z.string(),
});

export const accountHealthWatchlistSchema = z.object({
  data: z.array(accountHealthEntryApiSchema),
});

export const accountHealthBreakdownSchema = z.object({
  data: z.object({
    accountId: z.string().uuid(),
    score: z.number(),
    storedScore: z.number(),
    band: healthBandSchema,
    contributingFactors: z.array(z.object({
      signal: z.string(),
      value: z.number(),
      weight: z.number(),
      contribution: z.number(),
      clamped: z.boolean(),
    })),
    computedAt: z.string(),
    version: z.number().int(),
  }),
});

export const crmForecastStageApiSchema = z.object({
  stageId: z.string().min(1),
  stageName: z.string(),
  probability: z.number(),
  /** bigint paise serialised as a string */
  weightedTotal: z.string(),
});

export const crmForecastSchema = z.object({
  data: z.object({
    /** bigint paise serialised as a string */
    totalForecast: z.string(),
    dealCount: z.number().int(),
    stages: z.array(crmForecastStageApiSchema),
  }),
});

/**
 * Voice-of-Customer aggregate (P2-6). `truncated` is nullish-tolerant so an older
 * service that predates the flag reads as "the window was complete" rather than
 * failing the whole response.
 */
export const crmVocSummarySchema = z.object({
  data: z.object({
    total: z.number().int(),
    byPolarity: z.object({
      positive: z.number().int(),
      neutral: z.number().int(),
      negative: z.number().int(),
    }),
    averageScore: z.number(),
    negativeShare: z.number(),
    topThemes: z.array(z.object({
      theme: z.string(),
      count: z.number().int(),
      negativeCount: z.number().int(),
    })),
    truncated: z.boolean().nullish().transform((v) => v ?? false),
  }),
});

/**
 * Campaign ROI (P1-6). crm-service serialises every money figure as a bigint
 * paise string and ROI as basis points, so the schema keeps them as strings —
 * coercing to number here would reintroduce the float rounding the service
 * deliberately avoids.
 */
const crmCampaignRoiFiguresSchema = z.object({
  costMinor: z.string(),
  revenueMinor: z.string(),
  netMinor: z.string(),
  responses: z.number().int(),
  roiBasisPoints: z.string().nullable(),
  roiPercent: z.string().nullable(),
  costPerResponseMinor: z.string().nullable(),
});

export const crmCampaignRoiSummarySchema = z.object({
  data: z.array(
    crmCampaignRoiFiguresSchema.extend({
      campaignId: z.string(),
      currency: z.string(),
      periods: z.number().int(),
    }),
  ),
});

export const crmCampaignRoiSchema = z.object({
  data: crmCampaignRoiFiguresSchema.extend({
    campaignId: z.string(),
    currency: z.string(),
    periods: z.array(
      crmCampaignRoiFiguresSchema.extend({
        periodStart: z.string().nullable(),
        periodEnd: z.string().nullable(),
      }),
    ),
  }),
});

/**
 * CDP golden profile (P1-14). `attributes` is an open bag by design — a tenant
 * decides what it stores on a profile — so it is passed through unvalidated
 * rather than pinned to a shape the service does not enforce either.
 */
const cdpProfileLineageEntrySchema = z.object({
  source: z.string(),
  sourceId: z.string(),
  timestamp: z.string(),
  attributes: z.array(z.string()).optional(),
});

const cdpProfileApiSchema = z.object({
  id: z.string(),
  profileType: z.string(),
  attributes: z.record(z.unknown()).default({}),
  sourceLineage: z.array(cdpProfileLineageEntrySchema).default([]),
  mergedFromIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
});

export const cdpProfileSchema = z.object({ data: cdpProfileApiSchema });
export const cdpProfileListSchema = z.object({ data: z.array(cdpProfileApiSchema) });

export const cdpIdentityLinkListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    profileId: z.string(),
    identifierType: z.string(),
    confidence: z.number(),
    createdAt: z.string(),
  })),
});

export const cdpProfileEventListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    profileId: z.string(),
    eventType: z.string(),
    occurredAt: z.string(),
  })),
});

export const crmLeadCaptureFormSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    tenantId: z.string(),
    formKey: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    requireConsent: z.boolean(),
    allowedOrigins: z.array(z.string()),
    defaultLeadSource: z.string().nullable(),
    campaignId: z.string().nullable(),
    maxPerMinute: z.number().int(),
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })),
});

export const crmControlTowerSchema = z.object({
  data: z.object({
    regions: z.array(z.object({
      region: z.string(),
      dealCount: z.number().int(),
      pipelineMinor: z.string(),
    })),
    exceptions: z.array(z.object({
      id: z.string(),
      kind: z.enum(["overdue_follow_up", "dormant_account", "aged_lead"]),
      label: z.string(),
      severity: z.enum(["high", "medium"]),
      href: z.string(),
      count: z.number().int(),
    })),
    drillDown: z.object({
      regionReport: z.string(),
      ageingReport: z.string(),
      accounts: z.string(),
    }),
  }),
});

export const notificationExperimentListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    winnerVariantId: z.string().nullable(),
    winnerMarginPct: z.number().nullable(),
    concludedAt: z.string().nullable(),
  })),
});




export const crmContactsListSchema = paginatedSchema(crmContactApiSchema);
export const crmAccountsListSchema = z.object({ data: z.array(crmAccountApiSchema) });
export const crmAccountHierarchyListSchema = z.object({ data: z.array(crmAccountHierarchyNodeSchema) });
export const crmDealsListSchema = paginatedSchema(crmDealApiSchema);
export const crmActivitiesListSchema = paginatedSchema(crmActivityApiSchema);
export const userListResponseSchema = z.array(z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  empCode: z.string().nullable(),
  status: z.string(),
  mfaEnabled: z.boolean(),
  version: z.number().int(),
}));

// Finance schemas
export const FinanceDashboardSchema = z.object({
  budgetUtilisationPct: z.number().default(0),
  pendingSanctions: z.number().default(0),
  paymentsThisMonth: z.number().default(0),
  totalExpenditure: z.number().default(0),
});

// Bigint-safe strings, not z.number(): budget/queries.ts's listBudgetSummaries
// returns sanctionedAmount/releasedAmount/expenditure/balance via .toString()
// (H3: paise can exceed 2^53) — a plain z.number() here means sendValidated()
// throws a ZodError (-> 400 VALIDATION_FAILED) the instant a tenant has one
// real non-zero budget row. Same fix already applied to BillSummarySchema
// above; this mirrors it for Budget/Sanctions, which had been missed.
export const BudgetSummarySchema = z.object({
  id: z.string(),
  majorHead: z.string(),
  subHead: z.string().optional(),
  sanctionedAmount: zMoneyMinorString,
  releasedAmount: zMoneyMinorString,
  expenditure: zMoneyMinorString,
  balance: zMoneyMinorString,
  beMinor: z.string(),
  reMinor: z.string(),
  status: z.string(),
  financialYear: z.string(),
});
export const BudgetSummaryListSchema = z.array(BudgetSummarySchema);

export const SanctionSummarySchema = z.object({
  id: z.string(),
  sanctionNo: z.string(),
  subject: z.string(),
  // Bigint-safe string: budget/queries.ts sends row.amountMinor.toString()
  // (H3: avoid 2^53 precision loss on large government sanction amounts).
  amount: zMoneyMinorString,
  sanctionedBy: z.string(),
  date: z.string(),
  status: z.enum(["approved", "pending", "rejected"]),
  majorHead: z.string(),
});
export const SanctionSummaryListSchema = z.array(SanctionSummarySchema);

export const SanctionDetailSchema = SanctionSummarySchema.extend({
  lineItems: z.array(z.object({
    description: z.string(),
    amount: zMoneyMinorString,
    head: z.string(),
  })).default([]),
  remarks: z.string().optional(),
  approvalTrail: z.array(z.object({
    actor: z.string(),
    action: z.string(),
    timestamp: z.string(),
  })).default([]),
});

export const BillSummarySchema = z.object({
  id: z.string(),
  billNo: z.string(),
  vendor: z.string(),
  // Bigint-safe string, not z.number(): payments/queries.ts's listBillSummaries
  // and getBillDetail return row.netMinor.toString() (paise can exceed 2^53),
  // so a plain z.number() here made GET /v1/finance/bills 400 on every call.
  amount: zMoneyMinorString,
  amountDisplay: z.string().optional(),
  submittedDate: z.string(),
  dueDate: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "rejected", "under_review"]),
  poRef: z.string().optional(),
  threeWayMatch: z.enum(["matched", "partial", "unmatched", "na"]).default("na"),
});
export const BillSummaryListSchema = z.array(BillSummarySchema);

export const BillDetailSchema = BillSummarySchema.extend({
  lineItems: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    // Same bigint-safe-string convention as BillSummarySchema.amount above
    // (money is integer-minor-unit strings throughout this codebase).
    amount: zMoneyMinorString,
    taxCode: z.string().optional(),
  })).default([]),
  grnRef: z.string().optional(),
  invoiceNo: z.string().optional(),
  paymentRef: z.string().optional(),
});

export const AdvanceSummarySchema = z.object({
  id: z.string(),
  advanceNo: z.string(),
  beneficiary: z.string(),
  type: z.enum(["employee", "vendor", "other"]),
  // Bigint-safe strings, not z.number(): payments/queries.ts's listAdvances
  // returns amount/adjustedAmount/balance via .toString() (H3: paise can
  // exceed 2^53), which a plain z.number() here would 400 on real data (it
  // only passed before because the advances table was empty).
  amount: zMoneyMinorString,
  disbursedDate: z.string(),
  dueDate: z.string().optional(),
  adjustedAmount: zMoneyMinorString.default(0),
  balance: zMoneyMinorString,
  status: z.enum(["active", "adjusted", "overdue", "closed"]),
});
export const AdvanceSummaryListSchema = z.array(AdvanceSummarySchema);

export const UCSummarySchema = z.object({
  id: z.string(),
  ucNo: z.string(),
  grantRef: z.string().optional(),
  grantee: z.string(),
  amount: z.number(),
  periodFrom: z.string(),
  periodTo: z.string(),
  submittedDate: z.string().optional(),
  status: z.enum(["pending", "submitted", "verified", "rejected"]),
});
export const UCSummaryListSchema = z.array(UCSummarySchema);

export const GLEntrySummarySchema = z.object({
  id: z.string(),
  voucherNo: z.string(),
  date: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  // Minor units (paise) as a bigint-safe decimal string, e.g. "500000" for
  // ₹5,000.00 — NOT rupees, NOT a float. Consumers pass this straight to
  // formatMoney(); do not divide by 100 or coerce with Number() anywhere in
  // this pipeline (see gl/queries.ts listJournalEntries for why that broke).
  debit: z.string().default("0"),
  credit: z.string().default("0"),
  narration: z.string().optional(),
  referenceNo: z.string().optional(),
  type: z.enum(["payment", "receipt", "journal", "budget"]).optional(),
});
export const GLEntrySummaryListSchema = z.array(GLEntrySummarySchema);

export const FinancialStatementSummarySchema = z.object({
  id: z.string(),
  head: z.string(),
  openingBalance: z.number(),
  receipts: z.number(),
  payments: z.number(),
  closingBalance: z.number(),
  type: z.enum(["asset", "liability", "income", "expenditure"]),
});
export const FinancialStatementSummaryListSchema = z.array(FinancialStatementSummarySchema);

// HR schemas
export const HRDashboardSchema = z.object({
  headcount: z.number().default(0),
  headcountLastMonth: z.number().default(0),
  attendanceTodayPct: z.number().default(0),
  pendingLeaves: z.number().default(0),
  onLeave: z.number().default(0),
  payrollDue: z.number().default(0),
  departmentBreakdown: z.array(z.object({ name: z.string(), count: z.number() })).default([]),
  employeeTypeBreakdown: z.array(z.object({ name: z.string(), count: z.number() })).default([]),
});

export const AttendanceSummaryItemSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  date: z.string(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: z.enum(["present", "absent", "half_day", "on_leave", "holiday"]),
  hoursWorked: z.number().optional(),
});
export const AttendanceSummaryListSchema = z.array(AttendanceSummaryItemSchema);

export const AttendanceRegularisationSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  date: z.string(),
  reason: z.string(),
  requestedStatus: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  requestedAt: z.string(),
});
export const AttendanceRegularisationListSchema = z.array(AttendanceRegularisationSchema);

export const LeaveRequestDetailSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  leaveType: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  days: z.number(),
  reason: z.string().optional(),
  approver: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  appliedAt: z.string(),
});
export const LeaveRequestDetailListSchema = z.array(LeaveRequestDetailSchema);

export const PayrollRunDetailSchema = z.object({
  id: z.string(),
  runDate: z.string(),
  payPeriod: z.string(),
  employeeCount: z.number(),
  grossAmount: z.number(),
  netAmount: z.number(),
  deductions: z.number(),
  status: z.enum(["draft", "processing", "completed", "paid"]),
});
export const PayrollRunDetailListSchema = z.array(PayrollRunDetailSchema);

export const PayrollRunFullDetailSchema = PayrollRunDetailSchema.extend({
  salarySlips: z.array(z.object({
    id: z.string(),
    employeeId: z.string(),
    employeeName: z.string(),
    gross: z.number(),
    deductions: z.number(),
    net: z.number(),
    status: z.string(),
  })).default([]),
});

export const SalarySlipSummarySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  payPeriod: z.string(),
  gross: z.number(),
  deductions: z.number(),
  net: z.number(),
  status: z.enum(["draft", "finalized", "paid"]),
});
export const SalarySlipSummaryListSchema = z.array(SalarySlipSummarySchema);

export const JobOpeningSummarySchema = z.object({
  id: z.string(),
  jobTitle: z.string(),
  department: z.string(),
  vacancies: z.number(),
  applicationDeadline: z.string().optional(),
  status: z.enum(["open", "closed", "on_hold"]),
  applicationsReceived: z.number().default(0),
  postedDate: z.string(),
});
export const JobOpeningSummaryListSchema = z.array(JobOpeningSummarySchema);

export const AppraisalSummarySchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  employeeName: z.string(),
  department: z.string(),
  appraisalPeriod: z.string(),
  rating: z.number().optional(),
  status: z.enum(["pending", "in_review", "completed"]),
  reviewerName: z.string().optional(),
});
export const AppraisalSummaryListSchema = z.array(AppraisalSummarySchema);

export const TrainingProgramSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  trainerName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
  venue: z.string().optional(),
  enrolledCount: z.number().default(0),
  maxCapacity: z.number().optional(),
  status: z.enum(["upcoming", "ongoing", "completed", "cancelled"]),
});
export const TrainingProgramSummaryListSchema = z.array(TrainingProgramSummarySchema);

export const EmployeeDetailSchema = z.object({
  id: z.string(),
  employeeId: z.string(),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  department: z.string(),
  designation: z.string(),
  grade: z.string().optional(),
  joiningDate: z.string(),
  status: z.string(),
  reportingTo: z.string().optional(),
  postingLocation: z.string().optional(),
});

type OrgChartNodeType = {
  id: string;
  name: string;
  designation: string;
  department: string;
  reportsTo?: string | null | undefined;
  children?: OrgChartNodeType[];
};

export const OrgChartNodeSchema: z.ZodType<OrgChartNodeType> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    designation: z.string(),
    department: z.string(),
    reportsTo: z.string().nullable().optional(),
    children: z.array(OrgChartNodeSchema).optional(),
  })
) as z.ZodType<OrgChartNodeType>;
export const OrgChartSchema = z.array(OrgChartNodeSchema);

// Procurement schemas
export const ProcurementDashboardSchema = z.object({
  pendingIndents: z.number().default(0),
  activePOs: z.number().default(0),
  grnsThisMonth: z.number().default(0),
  contractRenewalsDue: z.number().default(0),
});

export const IndentSummarySchema = z.object({
  id: z.string(),
  indentNo: z.string(),
  requestedBy: z.string(),
  department: z.string(),
  itemCount: z.number(),
  estimatedAmount: z.number(),
  requestDate: z.string(),
  requiredByDate: z.string().optional(),
  status: z.enum(["draft", "pending_approval", "approved", "rejected", "converted_to_po"]),
});
export const IndentSummaryListSchema = z.array(IndentSummarySchema);

export const IndentDetailSchema = IndentSummarySchema.extend({
  lineItems: z.array(z.object({
    itemCode: z.string(),
    itemName: z.string(),
    quantity: z.number(),
    unit: z.string(),
    estimatedUnitPrice: z.number(),
    totalPrice: z.number(),
  })).default([]),
  approvalTrail: z.array(z.object({
    actor: z.string(),
    action: z.string(),
    timestamp: z.string(),
    remarks: z.string().optional(),
  })).default([]),
});

export const VendorDetailSchema = z.object({
  id: z.string(),
  vendorCode: z.string(),
  name: z.string(),
  gstin: z.string().optional(),
  panNo: z.string().optional(),
  category: z.string(),
  empanelmentStatus: z.enum(["empanelled", "provisional", "blacklisted", "not_empanelled"]),
  rating: z.number().min(0).max(5).optional(),
  contactPerson: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  bankAccountNo: z.string().optional(),
  ifscCode: z.string().optional(),
  kycStatus: z.string().optional(),
  kycVerifiedAt: z.string().nullable().optional(),
});
export const VendorDetailListSchema = z.array(VendorDetailSchema);

export const RFQSummarySchema = z.object({
  id: z.string(),
  rfqNo: z.string(),
  title: z.string(),
  indentRef: z.string().optional(),
  vendorsInvited: z.number().default(0),
  responsesReceived: z.number().default(0),
  closingDate: z.string(),
  status: z.enum(["draft", "issued", "closed", "cancelled", "awarded"]),
});
export const RFQSummaryListSchema = z.array(RFQSummarySchema);

export const RFQDetailSchema = RFQSummarySchema.extend({
  description: z.string().optional(),
  lineItems: z.array(z.object({
    itemName: z.string(),
    quantity: z.number(),
    unit: z.string(),
  })).default([]),
  responses: z.array(z.object({
    vendorId: z.string(),
    vendorName: z.string(),
    totalAmount: z.number(),
    submittedAt: z.string(),
    status: z.string(),
  })).default([]),
});

export const GRNSummarySchema = z.object({
  id: z.string(),
  grnNo: z.string(),
  poRef: z.string(),
  vendor: z.string(),
  receivedDate: z.string(),
  receivedBy: z.string(),
  itemCount: z.number(),
  totalValue: z.number(),
  status: z.enum(["draft", "under_inspection", "received", "quality_check", "accepted", "partially_rejected", "rejected"]),
  threeWayMatch: z.boolean().optional(),
});
export const GRNSummaryListSchema = z.array(GRNSummarySchema);

export const TenderSummarySchema = z.object({
  id: z.string(),
  tenderNo: z.string(),
  title: z.string(),
  type: z.enum(["open", "limited", "single_source", "gem"]),
  estimatedValue: z.number(),
  publishDate: z.string().optional(),
  bidClosingDate: z.string(),
  openingDate: z.string().optional(),
  status: z.enum(["draft", "published", "evaluation", "awarded", "cancelled"]),
  bidsReceived: z.number().default(0),
});
export const TenderSummaryListSchema = z.array(TenderSummarySchema);

export const TenderDetailSchema = TenderSummarySchema.extend({
  scope: z.string().optional(),
  eligibilityCriteria: z.string().optional(),
  bids: z.array(z.object({
    // CRITICAL fix: bidAmount was required (no .optional()), but
    // procurement-service's queries.ts getTenderDetail deliberately sends
    // `bidAmount: undefined` for any bid whose financial envelope hasn't been
    // opened yet ("SEALING GUARD: financial value only surfaced once the
    // envelope is opened") — the two-envelope sealing property this module
    // exists to enforce. Because sendValidated() does a strict
    // TenderDetailSchema.parse(detail) server-side before every response,
    // GET /v1/procurement/tenders/:id threw a ZodError (-> 400
    // VALIDATION_FAILED) for ANY tender with at least one bid still sealed —
    // i.e. essentially every real tender between first-bid-submitted and
    // financial-open. The tender detail page was unreachable for that entire
    // window, not as an edge case but as the common case.
    bidAmount: z.number().optional(),
    // bidId: needed by the tender lifecycle UI to submit per-bid technical
    // evaluation results (POST /v1/procurement/tenders/:id/technical-evaluation
    // takes { results: [{ bidId, qualified, score }] }) — vendorId alone can't
    // stand in for it (a vendor's identity, not the bid row itself).
    // Optional so any other consumer relying on the previous shape can't break.
    bidId: z.string().optional(),
    vendorId: z.string(),
    vendorName: z.string(),
    technicalScore: z.number().optional(),
    financialScore: z.number().optional(),
    status: z.string(),
  })).default([]),
});

export const PurchaseOrderListItemSchema = z.object({
  id: z.string(),
  poNo: z.string(),
  vendor: z.string(),
  amount: z.number(),
  orderDate: z.string(),
  deliveryDate: z.string().optional(),
  grnStatus: z.string().optional(),
  status: z.enum(["draft", "pending", "approved", "dispatched", "partial_grn", "fully_received", "cancelled", "gem_placed"]),
});
export const PurchaseOrderListItemListSchema = z.array(PurchaseOrderListItemSchema);

export const PODetailSchema = z.object({
  id: z.string(),
  poNo: z.string(),
  vendor: z.string(),
  vendorId: z.string().optional(),
  orderDate: z.string(),
  deliveryDate: z.string().optional(),
  totalAmount: z.number(),
  status: z.enum(["draft", "approved", "partial_grn", "fully_received", "cancelled"]),
  lineItems: z.array(z.object({
    itemCode: z.string(),
    itemName: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unitPrice: z.number(),
    totalPrice: z.number(),
    grnQty: z.number().default(0),
  })).default([]),
});

// CRM + Helpdesk + Citizen schemas

export const CRMDashboardSchema = z.object({
  totalContacts: z.number().default(0),
  openDeals: z.number().default(0),
  activitiesToday: z.number().default(0),
  pipelineValue: z.number().default(0),
});

export const DealSummarySchema = z.object({
  id: z.string(),
  dealName: z.string(),
  contactId: z.string().optional(),
  contactName: z.string().optional(),
  stage: z.enum(["prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"]),
  amount: z.number(),
  owner: z.string(),
  closeDate: z.string().optional(),
  probability: z.number().min(0).max(100).default(0),
  status: z.enum(["open", "won", "lost"]),
});
export const DealSummaryListSchema = z.array(DealSummarySchema);

export const ContactDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  designation: z.string().optional(),
  city: z.string().optional(),
  lastActivityDate: z.string().optional(),
  leadStatus: z.string().optional(),
  marketingConsent: z.boolean().optional(),
  temperature: z.string().nullish(),
  priority: z.string().nullish(),
  segment: z.string().nullish(),
  product: z.string().nullish(),
  region: z.string().nullish(),
  expectedValueMinor: z.string().nullish(),
  expectedValueDisplay: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  deals: z.array(z.object({
    id: z.string(),
    dealName: z.string(),
    stage: z.string(),
    amount: z.number(),
  })).default([]),
  activityTimeline: z.array(z.object({
    id: z.string(),
    type: z.string(),
    subject: z.string(),
    dueDate: z.string().optional(),
    completedAt: z.string().optional(),
    status: z.string(),
  })).default([]),
});

export const CRMActivityEntrySchema = z.object({
  id: z.string(),
  type: z.enum(["call", "meeting", "email", "task", "note"]),
  subject: z.string(),
  relatedTo: z.string().optional(),
  relatedType: z.enum(["contact", "deal", "other"]).optional(),
  dueDate: z.string().optional(),
  completedAt: z.string().optional(),
  owner: z.string(),
  status: z.enum(["open", "overdue", "completed", "cancelled"]),
});
export const CRMActivityEntryListSchema = z.array(CRMActivityEntrySchema);

export const TicketDetailSchema = z.object({
  id: z.string(),
  ticketNo: z.string(),
  subject: z.string(),
  description: z.string().optional(),
  requesterName: z.string(),
  requesterEmail: z.string().optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  slaStatus: z.enum(["within_sla", "due_soon", "breached"]),
  status: z.enum(["open", "in_progress", "pending", "resolved", "closed"]),
  channel: z.enum(["web", "email", "phone", "walk_in"]).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  resolvedAt: z.string().optional(),
  comments: z.array(z.object({
    id: z.string(),
    author: z.string(),
    content: z.string(),
    createdAt: z.string(),
    isInternal: z.boolean().default(false),
  })).default([]),
});
export const TicketDetailListSchema = z.array(TicketDetailSchema);

export const TicketAnalyticsSchema = z.object({
  totalTickets: z.number().default(0),
  openTickets: z.number().default(0),
  resolvedThisMonth: z.number().default(0),
  slaBreachedCount: z.number().default(0),
  avgResolutionHours: z.number().default(0),
  byPriority: z.array(z.object({
    priority: z.string(),
    count: z.number(),
    pct: z.number(),
  })).default([]),
  byChannel: z.array(z.object({
    channel: z.string(),
    count: z.number(),
    pct: z.number(),
  })).default([]),
});

export const CitizenRequestSummarySchema = z.object({
  id: z.string(),
  requestNo: z.string(),
  serviceType: z.string(),
  citizenName: z.string(),
  citizenPhone: z.string().optional(),
  submittedAt: z.string(),
  expectedResolutionDate: z.string().optional(),
  status: z.enum(["submitted", "under_review", "in_progress", "resolved", "rejected"]),
  remarks: z.string().optional(),
});
export const CitizenRequestSummaryListSchema = z.array(CitizenRequestSummarySchema);

export const RTISummarySchema = z.object({
  id: z.string(),
  rtiNo: z.string(),
  applicantName: z.string(),
  subject: z.string(),
  publicAuthority: z.string().optional(),
  filedDate: z.string(),
  deadlineDate: z.string().optional(),
  transferredTo: z.string().optional(),
  status: z.enum(["received", "forwarded", "under_review", "replied", "appeal", "closed"]),
  isFirstAppeal: z.boolean().default(false),
  /** RTI Act 2005 §7: true when 30-day deadline has passed with no response */
  isOverdue: z.boolean().default(false),
});
export const RTISummaryListSchema = z.array(RTISummarySchema);

// Projects schemas
export const ProjectsDashboardSchema = z.object({
  totalProjects: z.number().default(0),
  onTrackPct: z.number().default(0),
  delayed: z.number().default(0),
  totalOutlay: z.number().default(0),
});

export const ProjectSummarySchema = z.object({
  id: z.string(),
  projectCode: z.string(),
  name: z.string(),
  scheme: z.string().optional(),
  department: z.string().optional(),
  startDate: z.string(),
  expectedEndDate: z.string().optional(),
  totalBudget: z.number(),
  expenditure: z.number().default(0),
  completionPct: z.number().default(0),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled", "delayed"]),
});
export const ProjectSummaryListSchema = z.array(ProjectSummarySchema);

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  description: z.string().optional(),
  milestones: z.array(z.object({
    id: z.string(),
    title: z.string(),
    dueDate: z.string(),
    completedDate: z.string().optional(),
    status: z.enum(["pending", "completed", "delayed"]),
  })).default([]),
  fundReleases: z.array(z.object({
    id: z.string(),
    releaseDate: z.string(),
    amount: z.number(),
    remarks: z.string().optional(),
  })).default([]),
});

export const MilestoneSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  dueDate: z.string(),
  completedDate: z.string().optional(),
  status: z.enum(["pending", "completed", "delayed"]),
  remarks: z.string().optional(),
});
export const MilestoneSummaryListSchema = z.array(MilestoneSummarySchema);

export const FundReleaseSummarySchema = z.object({
  id: z.string(),
  releaseNo: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  amount: z.number(),
  releaseDate: z.string(),
  releasedBy: z.string().optional(),
  installmentNo: z.number().optional(),
  remarks: z.string().optional(),
  status: z.enum(["sanctioned", "released", "utilized"]),
});
export const FundReleaseSummaryListSchema = z.array(FundReleaseSummarySchema);

export const SchemeSummarySchema = z.object({
  id: z.string(),
  schemeCode: z.string(),
  name: z.string(),
  ministry: z.string().optional(),
  department: z.string().optional(),
  fundingType: z.enum(["central", "state", "centrally_sponsored", "external"]),
  totalAllocation: z.number(),
  releasedAmount: z.number().default(0),
  projectCount: z.number().default(0),
  status: z.enum(["active", "completed", "discontinued"]),
});
export const SchemeSummaryListSchema = z.array(SchemeSummarySchema);

// Grants schemas
export const GrantsDashboardSchema = z.object({
  totalGrants: z.number().default(0),
  disbursedAmount: z.number().default(0),
  pendingUCs: z.number().default(0),
  totalGrantees: z.number().default(0),
  /** G-03 compliance monitoring: number of approved grants past their reporting deadline */
  overdueGrants: z.number().default(0),
  overdueGrantIds: z.array(z.string()).default([]),
});

export const GrantSummarySchema = z.object({
  id: z.string(),
  grantNo: z.string(),
  title: z.string(),
  grantor: z.string().optional(),
  granteeId: z.string().optional(),
  granteeName: z.string().optional(),
  totalAmount: z.number(),
  disbursedAmount: z.number().default(0),
  pendingAmount: z.number().default(0),
  sanctionDate: z.string(),
  purpose: z.string().optional(),
  status: z.enum(["active", "completed", "suspended", "cancelled"]),
});
export const GrantSummaryListSchema = z.array(GrantSummarySchema);

export const GrantDetailSchema = GrantSummarySchema.extend({
  conditions: z.string().optional(),
  installments: z.array(z.object({
    id: z.string(),
    installmentNo: z.number(),
    amount: z.number(),
    scheduledDate: z.string(),
    releasedDate: z.string().optional(),
    status: z.enum(["pending", "released", "utilized"]),
  })).default([]),
  ucs: z.array(z.object({
    id: z.string(),
    ucNo: z.string(),
    amount: z.number(),
    period: z.string(),
    status: z.string(),
  })).default([]),
});

export const GranteeSummarySchema = z.object({
  id: z.string(),
  granteeCode: z.string(),
  name: z.string(),
  type: z.enum(["ngo", "government", "institution", "individual"]),
  registrationNo: z.string().optional(),
  panNo: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  activeGrants: z.number().default(0),
  totalGrantsReceived: z.number().default(0),
  ucCompliancePct: z.number().default(0),
});
export const GranteeSummaryListSchema = z.array(GranteeSummarySchema);

export const GrantInstallmentSummarySchema = z.object({
  id: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  installmentNo: z.number(),
  amount: z.number(),
  scheduledDate: z.string(),
  releasedDate: z.string().optional(),
  status: z.enum(["pending", "released", "utilized"]),
});
export const GrantInstallmentSummaryListSchema = z.array(GrantInstallmentSummarySchema);

export const GrantReleaseSchema = z.object({
  id: z.string(),
  releaseNo: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  amount: z.number(),
  releaseDate: z.string(),
  bankRef: z.string().optional(),
  status: z.enum(["pending", "processed", "credited"]),
});
export const GrantReleaseListSchema = z.array(GrantReleaseSchema);

export const GrantUtilizationSchema = z.object({
  id: z.string(),
  ucNo: z.string(),
  grantId: z.string(),
  grantNo: z.string(),
  granteeName: z.string(),
  amount: z.number(),
  periodFrom: z.string(),
  periodTo: z.string(),
  submittedDate: z.string().optional(),
  verifiedDate: z.string().optional(),
  status: z.enum(["pending", "submitted", "verified", "rejected"]),
});
export const GrantUtilizationListSchema = z.array(GrantUtilizationSchema);

// Establishment schemas
export const EstabDashboardSchema = z.object({
  filesPending: z.number().default(0),
  meetingsToday: z.number().default(0),
  vehiclesInUse: z.number().default(0),
  complianceItemsDue: z.number().default(0),
  slaBreached: z.number().default(0),
  dakPending: z.number().default(0),
  avgPendencyDays: z.number().default(0),
});

export const EstabFileSummarySchema = z.object({
  id: z.string(),
  fileNo: z.string(),
  subject: z.string(),
  classification: z.enum(["top_secret", "secret", "confidential", "restricted", "unclassified"]),
  department: z.string().optional(),
  createdBy: z.string(),
  createdDate: z.string(),
  currentHolder: z.string().optional(),
  status: z.enum(["active", "pending", "archived", "disposed"]),
  tags: z.array(z.string()).default([]),
});
export const EstabFileSummaryListSchema = z.array(EstabFileSummarySchema);

export const EstabFileDetailSchema = EstabFileSummarySchema.extend({
  noteSheets: z.array(z.object({
    id: z.string(),
    author: z.string(),
    content: z.string(),
    timestamp: z.string(),
    type: z.enum(["note", "order", "remark"]),
  })).default([]),
  dispatchHistory: z.array(z.object({
    id: z.string(),
    dispatchedTo: z.string(),
    dispatchedBy: z.string(),
    timestamp: z.string(),
    remarks: z.string().optional(),
  })).default([]),
  attachments: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    fileType: z.string(),
    size: z.number(),
    uploadedAt: z.string(),
  })).default([]),
});

export const MeetingSummarySchema = z.object({
  id: z.string(),
  meetingNo: z.string(),
  title: z.string(),
  type: z.enum(["cabinet", "committee", "department", "review", "external"]),
  scheduledDate: z.string(),
  scheduledTime: z.string().optional(),
  venue: z.string().optional(),
  chairperson: z.string().optional(),
  attendeesCount: z.number().default(0),
  agendaItemsCount: z.number().default(0),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "postponed"]),
});
export const MeetingSummaryListSchema = z.array(MeetingSummarySchema);

export const MeetingDetailSchema = MeetingSummarySchema.extend({
  agenda: z.array(z.object({
    id: z.string(),
    itemNo: z.number(),
    title: z.string(),
    description: z.string().optional(),
    decision: z.string().optional(),
  })).default([]),
  minutes: z.string().optional(),
  attendees: z.array(z.object({
    name: z.string(),
    designation: z.string().optional(),
    present: z.boolean().default(true),
  })).default([]),
  actionPoints: z.array(z.object({
    id: z.string(),
    description: z.string(),
    assignedTo: z.string(),
    dueDate: z.string().optional(),
    status: z.enum(["pending", "completed"]),
  })).default([]),
});

export const VehicleSummarySchema = z.object({
  id: z.string(),
  vehicleNo: z.string(),
  make: z.string(),
  model: z.string(),
  type: z.enum(["sedan", "suv", "bus", "van", "truck", "ambulance", "other"]),
  assignedTo: z.string().optional(),
  driverName: z.string().optional(),
  fuelType: z.enum(["petrol", "diesel", "cng", "electric"]),
  status: z.enum(["available", "in_use", "maintenance", "reserved", "disposed"]),
  lastServiceDate: z.string().optional(),
  nextServiceDue: z.string().optional(),
  odometerKm: z.number().default(0),
});
export const VehicleSummaryListSchema = z.array(VehicleSummarySchema);

export const GuesthouseBookingSummarySchema = z.object({
  id: z.string(),
  bookingNo: z.string(),
  guestName: z.string(),
  designation: z.string().optional(),
  department: z.string().optional(),
  checkInDate: z.string(),
  checkOutDate: z.string(),
  roomType: z.string().optional(),
  roomNo: z.string().optional(),
  purposeOfVisit: z.string().optional(),
  status: z.enum(["pending", "confirmed", "checked_in", "checked_out", "cancelled"]),
});
export const GuesthouseBookingSummaryListSchema = z.array(GuesthouseBookingSummarySchema);

export const LibraryBookSummarySchema = z.object({
  id: z.string(),
  accessionNo: z.string(),
  title: z.string(),
  author: z.string().optional(),
  isbn: z.string().optional(),
  category: z.string().optional(),
  copiesTotal: z.number(),
  copiesAvailable: z.number(),
  status: z.enum(["available", "unavailable"]),
});
export const LibraryBookSummaryListSchema = z.array(LibraryBookSummarySchema);

export const LibraryIssueSummarySchema = z.object({
  id: z.string(),
  bookId: z.string(),
  bookTitle: z.string().optional(),
  borrowerRef: z.string(),
  issuedAt: z.string(),
  dueAt: z.string(),
  returnedAt: z.string().optional(),
  status: z.enum(["issued", "returned", "overdue"]),
});
export const LibraryIssueSummaryListSchema = z.array(LibraryIssueSummarySchema);

export const ComplianceSummarySchema = z.object({
  id: z.string(),
  complianceCode: z.string(),
  title: z.string(),
  category: z.string(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual", "one_time"]),
  dueDate: z.string(),
  assignedTo: z.string().optional(),
  status: z.enum(["pending", "complied", "overdue", "not_applicable"]),
  lastCompliedDate: z.string().optional(),
  remarks: z.string().optional(),
});
export const ComplianceSummaryListSchema = z.array(ComplianceSummarySchema);

// Asset schemas
export const AssetDashboardSchema = z.object({
  totalAssets: z.number().default(0),
  fixedAssets: z.number().default(0),
  infraAssets: z.number().default(0),
  underMaintenance: z.number().default(0),
  dueForDisposal: z.number().default(0),
  taggedAssets: z.number().default(0),
  netBlock: z.number().default(0),
  recentGrnAssets: z.array(z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    acquisitionDate: z.string(),
    acquisitionCost: z.number(),
  })).default([]),
});

export const AssetSummarySchema = z.object({
  id: z.string(),
  assetCode: z.string(),
  name: z.string(),
  category: z.string(),
  type: z.enum(["fixed", "infra", "movable", "it", "vehicle", "other"]),
  purchaseDate: z.string(),
  purchaseCost: z.number(),
  currentValue: z.number(),
  location: z.string().optional(),
  assignedTo: z.string().optional(),
  department: z.string().optional(),
  status: z.enum(["active", "in_use", "maintenance", "disposed", "condemned"]),
  condition: z.enum(["excellent", "good", "fair", "poor"]).optional(),
});
export const AssetSummaryListSchema = z.array(AssetSummarySchema);

export const AssetDetailSchema = AssetSummarySchema.extend({
  description: z.string().optional(),
  serialNo: z.string().optional(),
  warrantyExpiry: z.string().optional(),
  depreciationSchedule: z.array(z.object({
    year: z.number(),
    openingValue: z.number(),
    depreciationAmount: z.number(),
    closingValue: z.number(),
    rate: z.number(),
  })).default([]),
  maintenanceHistory: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.string(),
    description: z.string(),
    cost: z.number(),
    vendor: z.string().optional(),
  })).default([]),
});

export const MaintenanceSummarySchema = z.object({
  id: z.string(),
  assetId: z.string(),
  assetCode: z.string(),
  assetName: z.string(),
  maintenanceType: z.enum(["preventive", "corrective", "amc", "breakdown"]),
  scheduledDate: z.string(),
  completedDate: z.string().optional(),
  vendor: z.string().optional(),
  estimatedCost: z.number().default(0),
  actualCost: z.number().default(0),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled", "overdue"]),
  remarks: z.string().optional(),
});
export const MaintenanceSummaryListSchema = z.array(MaintenanceSummarySchema);

// Stock schemas
export const StockDashboardSchema = z.object({
  totalSKUs: z.number().default(0),
  lowStockAlerts: z.number().default(0),
  grnsThisMonth: z.number().default(0),
  inventoryValue: z.number().default(0),
});

export const StockItemSummarySchema = z.object({
  id: z.string(),
  itemCode: z.string(),
  name: z.string(),
  category: z.string(),
  unit: z.string(),
  currentStock: z.number(),
  minStockLevel: z.number().default(0),
  maxStockLevel: z.number().optional(),
  unitCost: z.number(),
  totalValue: z.number(),
  warehouseLocation: z.string().optional(),
  isLowStock: z.boolean().default(false),
  lastReceivedDate: z.string().optional(),
  lastIssuedDate: z.string().optional(),
});
export const StockItemSummaryListSchema = z.array(StockItemSummarySchema);

export const StockItemDetailSchema = StockItemSummarySchema.extend({
  description: z.string().optional(),
  hsnCode: z.string().optional(),
  gstRate: z.number().optional(),
  stockLedger: z.array(z.object({
    id: z.string(),
    date: z.string(),
    type: z.enum(["receipt", "issue", "transfer", "adjustment"]),
    quantity: z.number(),
    unitCost: z.number(),
    totalValue: z.number(),
    referenceNo: z.string().optional(),
    party: z.string().optional(),
    balance: z.number(),
  })).default([]),
});

export const StockLedgerEntrySchema = z.object({
  id: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  date: z.string(),
  type: z.enum(["receipt", "issue", "transfer", "adjustment"]),
  quantity: z.number(),
  unitCost: z.number(),
  totalValue: z.number(),
  referenceNo: z.string().optional(),
  party: z.string().optional(),
  warehouseLocation: z.string().optional(),
  balance: z.number(),
});

// ── Audit schemas ─────────────────────────────────────────────────────────────

export const AuditDashboardSchema = z.object({
  openObservations: z.number().default(0),
  riskRegisterItems: z.number().default(0),
  cagParas: z.number().default(0),
  compliancePct: z.number().default(0),
});

export const AuditObservationSummarySchema = z.object({
  id: z.string(),
  observationNo: z.string(),
  title: z.string(),
  type: z.enum(["internal", "cag", "statutory", "concurrent"]),
  severity: z.enum(["critical", "major", "minor", "observation"]),
  department: z.string().optional(),
  auditPeriod: z.string().optional(),
  raisedDate: z.string(),
  dueDate: z.string().optional(),
  status: z.enum(["open", "replied", "partially_closed", "closed", "compliance_pending"]),
  para: z.string().optional(),
});
export const AuditObservationSummaryListSchema = z.array(AuditObservationSummarySchema);

export const AuditObservationDetailSchema = AuditObservationSummarySchema.extend({
  description: z.string().optional(),
  amount: z.number().optional(),
  recommendations: z.string().optional(),
  replies: z.array(z.object({
    id: z.string(),
    repliedBy: z.string(),
    content: z.string(),
    repliedAt: z.string(),
    acceptedByAuditor: z.boolean().optional(),
  })).default([]),
  closureDetails: z.string().optional(),
});

export const RiskSummarySchema = z.object({
  id: z.string(),
  riskCode: z.string(),
  title: z.string(),
  category: z.enum(["financial", "operational", "compliance", "reputational", "strategic", "it"]),
  likelihood: z.enum(["rare", "unlikely", "possible", "likely", "almost_certain"]),
  impact: z.enum(["negligible", "minor", "moderate", "major", "catastrophic"]),
  riskScore: z.number(),
  owner: z.string().optional(),
  mitigationStatus: z.enum(["not_started", "in_progress", "implemented", "accepted"]),
  reviewDate: z.string().optional(),
  status: z.enum(["open", "mitigated", "closed", "escalated"]),
});
export const RiskSummaryListSchema = z.array(RiskSummarySchema);

export const AuditPlanItemSchema = z.object({
  id: z.string(),
  auditUnit: z.string(),
  department: z.string(),
  type: z.enum(["routine", "special", "compliance", "performance"]),
  plannedFrom: z.string(),
  plannedTo: z.string(),
  auditorTeam: z.string().optional(),
  status: z.enum(["planned", "in_progress", "completed", "deferred"]),
});
export const AuditPlanListSchema = z.array(AuditPlanItemSchema);

export const AuditComplianceItemSchema = z.object({
  id: z.string(),
  lawOrRule: z.string(),
  section: z.string().optional(),
  requirement: z.string(),
  frequency: z.string(),
  dueDate: z.string(),
  department: z.string().optional(),
  status: z.enum(["complied", "pending", "overdue", "na"]),
  evidence: z.string().optional(),
});
export const AuditComplianceListSchema = z.array(AuditComplianceItemSchema);

export const AuditExportJobSchema = z.object({
  id: z.string(),
  jobType: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  format: z.enum(["pdf", "xlsx", "csv"]),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  downloadUrl: z.string().optional(),
});
export const AuditExportJobListSchema = z.array(AuditExportJobSchema);

export const CagParaSummarySchema = z.object({
  id: z.string(),
  reportYear: z.string(),
  paraNo: z.string(),
  department: z.string(),
  totalParas: z.number(),
  settled: z.number(),
  pending: z.number(),
  status: z.enum(["under_review", "partially_settled", "nearly_settled", "settled"]),
});
export const CagParaSummaryListSchema = z.array(CagParaSummarySchema);

export const VigilanceCaseSummarySchema = z.object({
  id: z.string(),
  caseNo: z.string(),
  officer: z.string(),
  charges: z.string(),
  inquiryStatus: z.enum(["preliminary_enquiry", "under_investigation", "charge_sheet_issued", "inquiry_complete"]),
  outcome: z.enum(["pending", "major_penalty", "minor_penalty", "exonerated"]),
});
export const VigilanceCaseSummaryListSchema = z.array(VigilanceCaseSummarySchema);

export const InvestigationSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  subject: z.string(),
  assignedTo: z.string(),
  started: z.string(),
  findings: z.string(),
  status: z.enum(["in_progress", "findings_submitted", "closed"]),
});
export const InvestigationSummaryListSchema = z.array(InvestigationSummarySchema);

// ── Legal schemas ─────────────────────────────────────────────────────────────

export const LegalDashboardSchema = z.object({
  activeCases: z.number().default(0),
  hearingsThisWeek: z.number().default(0),
  ordersPending: z.number().default(0),
  opinionsDue: z.number().default(0),
});

export const LegalCaseSummarySchema = z.object({
  id: z.string(),
  caseNo: z.string(),
  title: z.string(),
  court: z.string(),
  type: z.enum(["civil", "criminal", "arbitration", "tribunal", "writ", "appeal", "other"]),
  filedDate: z.string(),
  department: z.string().optional(),
  petitioner: z.string().optional(),
  respondent: z.string().optional(),
  advocateName: z.string().optional(),
  nextHearingDate: z.string().optional(),
  status: z.enum(["active", "disposed", "stayed", "transferred", "dismissed", "settled"]),
});
export const LegalCaseSummaryListSchema = z.array(LegalCaseSummarySchema);

export const LegalCaseDetailSchema = LegalCaseSummarySchema.extend({
  description: z.string().optional(),
  hearings: z.array(z.object({
    id: z.string(),
    date: z.string(),
    court: z.string(),
    purpose: z.string().optional(),
    outcome: z.string().optional(),
    nextDate: z.string().optional(),
  })).default([]),
  orders: z.array(z.object({
    id: z.string(),
    date: z.string(),
    orderNo: z.string().optional(),
    summary: z.string(),
    complianceRequired: z.boolean().default(false),
    complianceDeadline: z.string().optional(),
    status: z.enum(["pending", "complied", "appealed"]),
  })).default([]),
});

export const HearingSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseNo: z.string(),
  caseTitle: z.string(),
  court: z.string(),
  date: z.string(),
  time: z.string().optional(),
  purpose: z.string().optional(),
  outcome: z.string().optional(),
  nextDate: z.string().optional(),
  status: z.enum(["scheduled", "completed", "adjourned", "cancelled"]),
});
export const HearingSummaryListSchema = z.array(HearingSummarySchema);

export const CourtOrderSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseNo: z.string(),
  court: z.string(),
  orderDate: z.string(),
  orderNo: z.string().optional(),
  summary: z.string(),
  complianceRequired: z.boolean().default(false),
  complianceDeadline: z.string().optional(),
  department: z.string().optional(),
  status: z.enum(["pending", "complied", "appealed", "stayed"]),
});
export const CourtOrderSummaryListSchema = z.array(CourtOrderSummarySchema);

export const LegalOpinionSummarySchema = z.object({
  id: z.string(),
  opinionNo: z.string(),
  subject: z.string(),
  requestedBy: z.string(),
  requestDate: z.string(),
  dueDate: z.string().optional(),
  advisorName: z.string().optional(),
  status: z.enum(["pending", "draft", "issued", "revised"]),
  issuedDate: z.string().optional(),
});
export const LegalOpinionSummaryListSchema = z.array(LegalOpinionSummarySchema);
export const StockLedgerEntryListSchema = z.array(StockLedgerEntrySchema);

// ── Admin / Platform schemas ───────────────────────────────────────────────────

export const SessionSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  userName: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
  expiresAt: z.string(),
  mfaVerified: z.boolean().default(false),
  status: z.enum(["active", "expired", "revoked"]),
});
export const SessionSummaryListSchema = z.array(SessionSummarySchema);

export const BreakglassSummarySchema = z.object({
  id: z.string(),
  actor: z.string(),
  actorEmail: z.string(),
  reason: z.string(),
  resourceAccessed: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  status: z.enum(["active", "ended", "auto_expired"]),
});
export const BreakglassSummaryListSchema = z.array(BreakglassSummarySchema);

export const APIKeySummarySchema = z.object({
  id: z.string(),
  keyName: z.string(),
  keyPrefix: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  status: z.enum(["active", "expired", "revoked"]),
});
export const APIKeySummaryListSchema = z.array(APIKeySummarySchema);

export const InstallStepSummarySchema = z.object({
  id: z.string(),
  stepNo: z.number(),
  title: z.string(),
  description: z.string().optional(),
  isRequired: z.boolean().default(true),
  status: z.enum(["pending", "in_progress", "completed", "failed", "skipped"]),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
});
export const InstallStepSummaryListSchema = z.array(InstallStepSummarySchema);

export const NotificationPrefSummarySchema = z.object({
  id: z.string(),
  eventType: z.string(),
  module: z.string(),
  label: z.string(),
  emailEnabled: z.boolean().default(false),
  smsEnabled: z.boolean().default(false),
  inAppEnabled: z.boolean().default(true),
  webhookEnabled: z.boolean().default(false),
});
export const NotificationPrefSummaryListSchema = z.array(NotificationPrefSummarySchema);

export const UserDetailSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  roles: z.array(z.string()).default([]),
  mfaEnabled: z.boolean().default(false),
  lastLoginAt: z.string().optional(),
  status: z.enum(["active", "inactive", "suspended", "pending_verification"]),
  createdAt: z.string(),
  sessions: z.array(z.object({
    id: z.string(),
    ipAddress: z.string().optional(),
    createdAt: z.string(),
    lastActiveAt: z.string(),
    status: z.string(),
  })).default([]),
});

export const RoleDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isSystemRole: z.boolean().default(false),
  permissions: z.array(z.object({
    module: z.string(),
    action: z.string(),
    resource: z.string().optional(),
    allowed: z.boolean(),
  })).default([]),
  userCount: z.number().default(0),
  createdAt: z.string(),
});

export const SubscriptionSummarySchema = z.object({
  id: z.string(),
  plan: z.string(),
  status: z.enum(["active", "past_due", "cancelled", "trial"]),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  userLimit: z.number().optional(),
  activeUsers: z.number().default(0),
  moduleAccess: z.array(z.string()).default([]),
  billingEmail: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().default("INR"),
});

export const TenantModuleSchema = z.object({
  moduleKey: z.string(),
  moduleName: z.string(),
  enabled: z.boolean().default(true),
  enabledAt: z.string().optional(),
});
export const TenantModuleListSchema = z.array(TenantModuleSchema);

export const AdminUserSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
  roles: z.array(z.string()).default([]),
  mfaEnabled: z.boolean().default(false),
  lastLoginAt: z.string().optional(),
  status: z.string(),
  createdAt: z.string(),
});
export const AdminUserSummaryListSchema = z.array(AdminUserSummarySchema);

export const AdminRoleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isSystemRole: z.boolean().default(false),
  userCount: z.number().default(0),
  createdAt: z.string(),
});
export const AdminRoleSummaryListSchema = z.array(AdminRoleSummarySchema);

export const TenantAuditEventSchema = z.object({
  id: z.string(),
  actor: z.string(),
  action: z.string(),
  resource: z.string().optional(),
  outcome: z.string(),
  timestamp: z.string(),
  ipAddress: z.string().optional(),
});
export const TenantAuditEventListSchema = z.array(TenantAuditEventSchema);

// ── Analytics / Reports schemas ───────────────────────────────────────────────

export const ReportDashboardItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  module: z.string(),
  value: z.number().optional(),
  unit: z.string().optional(),
  changePct: z.number().optional(),
  changeDirection: z.enum(["up", "down", "neutral"]).optional(),
});
export const ReportDashboardSchema = z.object({
  kpis: z.array(ReportDashboardItemSchema).default([]),
  summary: z.string().optional(),
});

export const ReportJobSummarySchema = z.object({
  id: z.string(),
  reportName: z.string(),
  module: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  completedAt: z.string().optional(),
  format: z.enum(["pdf", "xlsx", "csv", "html"]),
  status: z.enum(["queued", "running", "completed", "failed"]),
  downloadUrl: z.string().optional(),
  rowCount: z.number().optional(),
});
export const ReportJobSummaryListSchema = z.array(ReportJobSummarySchema);

export const ReportJobDetailSchema = ReportJobSummarySchema.extend({
  parameters: z.record(z.string()).optional(),
  columns: z.array(z.string()).default([]),
  rows: z.array(z.record(z.string())).default([]),
  totalCount: z.number().default(0),
});

export const KPISummarySchema = z.object({
  id: z.string(),
  kpiName: z.string(),
  module: z.string(),
  targetValue: z.number(),
  currentValue: z.number(),
  unit: z.string(),
  achievementPct: z.number(),
  period: z.string(),
  trend: z.enum(["up", "down", "stable"]),
  status: z.enum(["on_track", "at_risk", "off_track"]),
});
export const KPISummaryListSchema = z.array(KPISummarySchema);

export const MISSummarySchema = z.object({
  module: z.string(),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    unit: z.string().optional(),
    change: z.string().optional(),
  })),
});
export const MISSummaryListSchema = z.array(MISSummarySchema);

// ── Knowledge / DMS schemas ───────────────────────────────────────────────────

export const KnowledgeDocSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  author: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(["draft", "under_review", "approved", "archived"]),
  accessLevel: z.enum(["public", "internal", "restricted", "confidential"]),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
  version: z.string().default("1.0"),
});
export const KnowledgeDocSummaryListSchema = z.array(KnowledgeDocSummarySchema);

export const KnowledgeRecordSchema = z.object({
  id: z.string(),
  recordNo: z.string(),
  title: z.string(),
  type: z.enum(["file", "correspondence", "register", "other"]),
  department: z.string().optional(),
  createdDate: z.string(),
  retentionPeriod: z.string().optional(),
  disposalDueDate: z.string().optional(),
  status: z.enum(["active", "inactive", "disposed", "transferred"]),
});
export const KnowledgeRecordListSchema = z.array(KnowledgeRecordSchema);

export const KnowledgeSearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  excerpt: z.string().optional(),
  relevanceScore: z.number().optional(),
  documentType: z.string().optional(),
  createdAt: z.string(),
  url: z.string().optional(),
});
export const KnowledgeSearchResultListSchema = z.array(KnowledgeSearchResultSchema);

// ── Notification schemas (enhanced) ──────────────────────────────────────────

export const NotificationItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  module: z.string(),
  eventType: z.string(),
  recipient: z.string(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  status: z.enum(["sent", "pending", "failed", "read"]),
  createdAt: z.string(),
  readAt: z.string().optional(),
});
export const NotificationItemListSchema = z.array(NotificationItemSchema);

export const NotificationDeliverySchema = z.object({
  id: z.string(),
  notificationId: z.string(),
  notificationTitle: z.string(),
  recipient: z.string(),
  channel: z.enum(["email", "sms", "in_app", "webhook"]),
  attemptCount: z.number().default(1),
  deliveredAt: z.string().optional(),
  failureReason: z.string().optional(),
  status: z.enum(["pending", "delivered", "failed", "bounced"]),
});
export const NotificationDeliveryListSchema = z.array(NotificationDeliverySchema);

export const PayrollStructureListSchema = z.array(z.object({ id: z.string(), name: z.string() }));

// ── Finance schemas (extended — data-layer type-safety pass) ────────────────
// Mirrors the types of the same name in @civitasone/types — see that file's
// header comment for the confidence/evidence notes per type.

export const FinancePaymentDetailSchema = z.object({
  id: z.string(),
  billId: z.string(),
  amountMinor: z.string(),
  mode: z.enum(["NEFT", "RTGS", "IMPS", "DBT", "PFMS", "cheque"]),
  status: z.string(),
  currency: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export const FinanceInstrumentSummarySchema = z.object({
  id: z.string(),
  instrumentType: z.string(),
  instrumentNo: z.string(),
  bankAccountId: z.string().nullable(),
  bankName: z.string(),
  payee: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  issueDate: z.string(),
  status: z.enum(["issued", "presented", "cleared", "bounced", "cancelled"]),
  presentedAt: z.string().nullable(),
  clearedAt: z.string().nullable(),
  bouncedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  bounceReason: z.string().nullable(),
});
export const FinanceInstrumentSummaryListSchema = z.array(FinanceInstrumentSummarySchema);

export const BudgetOutcomeSummarySchema = z.object({
  id: z.string(),
  headId: z.string(),
  fy: z.string(),
  allocationId: z.string().nullable(),
  schemeId: z.string().nullable(),
  outputDesc: z.string(),
  outcomeDesc: z.string(),
  indicator: z.string(),
  unit: z.string(),
  baselineValue: z.string(),
  targetValue: z.string(),
  achievedValue: z.string(),
  achievementBps: z.string(),
  allocatedMinor: z.string(),
  currency: z.string(),
  status: z.string(),
  evaluationRating: z.string().nullable(),
  evaluationNote: z.string().nullable(),
  evaluatedBy: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  effectiveFrom: z.string(),
});
export const BudgetOutcomeSummaryListSchema = z.array(BudgetOutcomeSummarySchema);

export const AllocationDistributionSummarySchema = z.object({
  id: z.string(),
  allocationId: z.string(),
  fy: z.string(),
  headId: z.string(),
  fromOfficeId: z.string(),
  toOfficeId: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  conditions: z.string().nullable(),
  status: z.string(),
  effectiveFrom: z.string(),
  issuedBy: z.string().nullable(),
  acknowledgedBy: z.string().nullable(),
  acknowledgeNote: z.string().nullable(),
  version: z.number(),
});
export const AllocationDistributionSummaryListSchema = z.array(AllocationDistributionSummarySchema);

// `enforce` was deliberately removed on the backend (DB column dropped in
// migrations/0067_drop_allocation_enforce.sql; allocation-routes.ts's own
// comment calls it a "misleading dead flag" that never worked as advertised)
// but this schema still required it — since GET /v1/finance/budget-allocations
// sends a plain 200 (no server-side sendValidated), the mismatch wasn't a
// 400: the frontend's own responseSchema.safeParse silently rejected every
// real row instead, collapsing the Allocation list to {data: [], source:
// "error"} the instant a tenant has real data.
export const FinanceBudgetAllocationSummarySchema = z.object({
  id: z.string(),
  headId: z.string(),
  fy: z.string(),
  allocatedMinor: z.string(),
  committedMinor: z.string(),
  actualMinor: z.string(),
  availableMinor: z.string(),
});
export const FinanceBudgetAllocationSummaryListSchema = z.array(FinanceBudgetAllocationSummarySchema);

export const BudgetMonitoringTotalsSchema = z.object({
  count: z.number(),
  allocatedMinor: z.string(),
  committedMinor: z.string(),
  actualMinor: z.string(),
  availableMinor: z.string(),
  forecastYearEndMinor: z.string(),
  exceptions: z.record(z.string(), z.number()),
});

export const BudgetMonitoringSummarySchema = z.object({
  fy: z.string(),
  fractionElapsedBps: z.string(),
  totals: BudgetMonitoringTotalsSchema,
});

export const BudgetMonitoringLineSchema = z.object({
  id: z.string(),
  headId: z.string(),
  fy: z.string(),
  allocatedMinor: z.string(),
  committedMinor: z.string(),
  actualMinor: z.string(),
  availableMinor: z.string(),
  burnRateBps: z.string(),
  utilisationBps: z.string(),
  forecastYearEndMinor: z.string(),
  exception: z.enum(["on_track", "over_committed", "under_utilised", "projected_overspend"]),
});
export const BudgetMonitoringLineListSchema = z.array(BudgetMonitoringLineSchema);

export const BudgetMonitoringLinesResponseSchema = z.object({
  fy: z.string(),
  asOf: z.string(),
  fractionElapsedBps: z.string(),
  totals: BudgetMonitoringTotalsSchema,
  lines: BudgetMonitoringLineListSchema,
});

export const VendorTdsEntrySchema = z.object({
  id: z.string(),
  vendor_id: z.string(),
  vendor_name: z.string(),
  pan: z.string().nullable(),
  bill_id: z.string().nullable(),
  payment_id: z.string().nullable(),
  section: z.string(),
  gross_amount_minor: z.string(),
  tds_rate_pct: z.string(),
  tds_amount_minor: z.string(),
  surcharge_minor: z.string(),
  cess_minor: z.string(),
  net_payment_minor: z.string(),
  deduction_date: z.string(),
  deposit_date: z.string().nullable(),
  challan_no: z.string().nullable(),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
  fy: z.string(),
  status: z.enum(["deducted", "deposited", "filed"]),
  created_at: z.string(),
});
export const VendorTdsEntryListSchema = z.array(VendorTdsEntrySchema);

export const PfmsBatchSummarySchema = z.object({
  id: z.string(),
  pfmsId: z.string(),
  type: z.string(),
  amountMinor: z.string(),
  agencyCode: z.string().nullable(),
  schemeCode: z.string().nullable(),
  ddoCode: z.string().nullable(),
  submissionStatus: z.string(),
  signedAt: z.string().nullable(),
});
export const PfmsBatchSummaryListSchema = z.array(PfmsBatchSummarySchema);

export const CashBookEntrySchema = z.object({
  id: z.string(),
  entry_date: z.string(),
  voucher_type: z.string(),
  voucher_no: z.string(),
  particulars: z.string(),
  receipt_minor: z.string(),
  payment_minor: z.string(),
  balance_minor: z.string(),
  bank_or_cash: z.string(),
  reference: z.string().nullable(),
  created_at: z.string(),
});
export const CashBookEntryListSchema = z.array(CashBookEntrySchema);

export const FinanceChallanSummarySchema = z.object({
  id: z.string(),
  challanNo: z.string(),
  receiptHeadId: z.string(),
  depositor: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  grnNo: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceChallanSummaryListSchema = z.array(FinanceChallanSummarySchema);

export const FinanceDepositSummarySchema = z.object({
  id: z.string(),
  pdNo: z.string(),
  type: z.string(),
  administrator: z.string(),
  balanceMinor: z.string(),
  currency: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceDepositSummaryListSchema = z.array(FinanceDepositSummarySchema);

export const FinanceGuaranteeSummarySchema = z.object({
  id: z.string(),
  entity: z.string(),
  type: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  feePct: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceGuaranteeSummaryListSchema = z.array(FinanceGuaranteeSummarySchema);

export const FinanceDebtSummarySchema = z.object({
  id: z.string(),
  instrument: z.string(),
  source: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  maturity: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceDebtSummaryListSchema = z.array(FinanceDebtSummarySchema);

export const FinanceSchemeSummarySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  outlayMinor: z.string(),
  utilisedMinor: z.string(),
  currency: z.string(),
  funding: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceSchemeSummaryListSchema = z.array(FinanceSchemeSummarySchema);

export const FinanceDemandSummarySchema = z.object({
  id: z.string(),
  demandNo: z.string(),
  service: z.string(),
  amountMinor: z.string(),
  currency: z.string(),
  class: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceDemandSummaryListSchema = z.array(FinanceDemandSummarySchema);

export const FinanceAuditParaSummarySchema = z.object({
  id: z.string(),
  paraNo: z.string(),
  source: z.string(),
  dept: z.string(),
  departmentId: z.string().nullable(),
  moneyValueMinor: z.string(),
  currency: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number(),
});
export const FinanceAuditParaSummaryListSchema = z.array(FinanceAuditParaSummarySchema);

export const DisciplinaryCaseDetailSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  employeeId: z.string(),
  caseNo: z.string(),
  proceedingType: z.string(),
  status: z.string(),
  allegation: z.string(),
  chargeMemoRef: z.string().nullable(),
  chargeMemoDate: z.string().nullable(),
  inquiryOfficerId: z.string().nullable(),
  inquiryOfficerName: z.string().nullable(),
  inquiryAppointedDate: z.string().nullable(),
  finding: z.string().nullable(),
  findingNotes: z.string().nullable(),
  findingDate: z.string().nullable(),
  penaltyClass: z.string().nullable(),
  penaltyType: z.string().nullable(),
  penaltyDetail: z.string().nullable(),
  penaltyDate: z.string().nullable(),
  appealFiledDate: z.string().nullable(),
  appealAuthority: z.string().nullable(),
  appealOutcome: z.string().nullable(),
  appealDecidedDate: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string(),
  version: z.number(),
});

export const FinanceVendorBillHistoryEntrySchema = z.object({
  id: z.string(),
  billNo: z.string(),
  date: z.string(),
  amount: z.string(),
  tds: z.string(),
  status: z.string(),
});

export const FinanceVendorDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  status: z.string(),
  pan: z.string(),
  gstin: z.string().nullable(),
  address: z.string(),
  contactPerson: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  bankName: z.string(),
  ifsc: z.string(),
  bankAccount: z.string(),
  isActive: z.boolean(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // Vendor<->bills rollup for the [id] page's Total Bills/Total Paid/TDS
  // Deducted stat cards + Bill History table (masters/routes.ts's
  // toVendorBillHistory()). Defaults to [] so a POST/PATCH echo (which never
  // looks bills up) still satisfies this schema.
  bills: z.array(FinanceVendorBillHistoryEntrySchema).default([]),
});

export const FinanceVendorSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  pan: z.string(),
  gstin: z.string().nullable(),
  status: z.string(),
  ratingDisplay: z.string(),
});
export const FinanceVendorSummaryListSchema = z.array(FinanceVendorSummarySchema);
