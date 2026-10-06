/**
 * works feature — shared TypeScript types.
 *
 * Mirrors the works-service HTTP contracts (services/works-service):
 *   billing/schema.ts (bills), tender/schema.ts (tenders), approval/schema.ts
 *   (administrative_approvals, technical_sanctions), execution/schema.ts
 *   (scope_progress, work_issues, work_closures), boq/schema.ts (boq_items).
 *
 * These are display-facing shapes assembled from the gateway responses; the
 * gateway maps /api/v1/works/* → the service's internal /v1/works/*. Money
 * fields are minor units (paise) serialized as strings by the service (see
 * shared/bigint-json.ts) — never coerce them through `number`.
 */

// ─── Billing (billing/schema.ts bills) ──────────────────────────────────────

/** bills.status: draft → {so,sdo,auditor,dao,do}_finalized → submitted. */
export type BillStatus =
  | "draft"
  | "so_finalized"
  | "sdo_finalized"
  | "auditor_finalized"
  | "dao_finalized"
  | "do_finalized"
  | "submitted";

export interface Bill {
  id: string;
  workId: string;
  awardId: string;
  mbId: string | null;
  billMode: string;
  billNumber: string;
  grossAmountMinor: string;
  deductionsMinor: string;
  netPayableMinor: string;
  status: BillStatus;
  ifmsRef: string | null;
  submittedAt: string | null;
  version: number;
  createdAt: string | null;
}

// ─── Tenders (tender/schema.ts tenders) ─────────────────────────────────────

export interface Tender {
  id: string;
  workId: string;
  tenderTypeId: string | null;
  tenderAmountMinor: string;
  openingDate: string | null;
  approvingAuthorityId: string | null;
  contractorClassId: string | null;
  remarks: string | null;
  version: number;
  createdAt: string | null;
}

// ─── Approvals (approval/schema.ts) ─────────────────────────────────────────

/** administrative_approvals.status / technical_sanctions.status. */
export type ApprovalStatus = "draft" | "finalized";
export type ApprovalKind = "original" | "revised";

export interface AdministrativeApproval {
  id: string;
  workId: string;
  aaNumber: string;
  aaDate: string;
  approvingAuthorityId: string;
  approvingOfficeId: string | null;
  approvedAmountMinor: string;
  remarks: string | null;
  approvalType: ApprovalKind;
  status: ApprovalStatus;
  finalizedAt: string | null;
  version: number;
  createdAt: string | null;
}

export interface TechnicalSanction {
  id: string;
  workId: string;
  tsNumber: string;
  tsDate: string;
  tsAuthorityId: string;
  tsOfficeId: string | null;
  tsAmountMinor: string;
  remarks: string | null;
  sanctionType: ApprovalKind;
  status: ApprovalStatus;
  finalizedAt: string | null;
  version: number;
  createdAt: string | null;
}

// ─── Execution (execution/schema.ts) ────────────────────────────────────────

/** A scope-progress reporting entry, joined back to its parent work-scope. */
export interface ExecutionProgress {
  id: string;
  workScopeId: string;
  workId: string;
  scopeId: string;
  targetValue: string | null;
  description: string | null;
  month: number;
  year: number;
  priorAchievement: string | null;
  currentAchievement: string | null;
  percentage: string | null;
  version: number;
}

/** work_issues.status: open | closed. */
export type IssueStatus = "open" | "closed";

export interface WorkIssue {
  id: string;
  workId: string;
  issueTypeId: string | null;
  forwardedTo: string | null;
  raisedDate: string;
  description: string;
  attachmentKey: string | null;
  status: IssueStatus;
  closedDate: string | null;
  version: number;
}

// ─── Closure (execution/schema.ts work_closures) ────────────────────────────

/** work_closures.closureType — also the FE tab key on the closure list page. */
export type ClosureType = "closed" | "dropped" | "completion";

/**
 * GAP-WORKS-CLOSURE-03: the canonical closure-type tab keys plus an "other"
 * catch-all. The backend close route (execution/validators.ts closeWorkSchema)
 * only ever emits closed | dropped | completion today, but a legacy/unknown
 * value must still be countable and visible rather than silently dropped from
 * every tab (it previously defaulted to "closed", mislabelling it).
 */
export const CLOSURE_TYPES = ["closed", "dropped", "completion"] as const;
export type NormalizedClosureType = ClosureType | "other";

/** Fold any raw closureType to a known tab key; unknown -> "other". */
export function normalizeClosureType(raw: unknown): NormalizedClosureType {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (CLOSURE_TYPES as readonly string[]).includes(v) ? (v as ClosureType) : "other";
}

export interface WorkClosure {
  id: string;
  workId: string;
  closureType: ClosureType;
  closedDate: string;
  remarks: string | null;
  version: number;
}

// ─── BoQ (boq/schema.ts boq_items) ──────────────────────────────────────────

export interface BoqItem {
  id: string;
  workId: string;
  srItemId: string | null;
  itemType: string | null;
  itemDescription: string;
  itemCode: string | null;
  unit: string;
  rate: string;
  quantity: string;
  scopeId: string | null;
  remarks: string | null;
  amountMinor: string;
  version: number;
  createdAt: string | null;
}

// ─── Reporting (reporting/routes.ts) ────────────────────────────────────────

export interface WorksSummary {
  totalWorks: number;
  activeWorks: number;
  closedWorks: number;
}

export interface WorksStatusCount {
  status: string;
  count: number;
}
