import { classifyBudgetHead, type HeadNature } from "@civitasone/schemas/budget-heads";
/** Pure budget domain logic — no DB, no HTTP, no queue. Unit-tested in isolation. */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02: a minor (level 1) / sub-minor (level 2)
 * head must hang under a head exactly one level above it; a major head
 * (level 0) has no parent. `parent` is the looked-up (tenant-scoped) head, or
 * null when no parent was supplied / it was not found.
 */
export function assertValidHeadParent(
  level: number,
  parentSupplied: boolean,
  parent: { level: number } | null,
): void {
  if (level === 0) {
    if (parentSupplied) throw new DomainError("HEAD_PARENT_NOT_ALLOWED", "A major head cannot have a parent head");
    return;
  }
  if (!parentSupplied) throw new DomainError("HEAD_PARENT_REQUIRED", "A minor or sub-minor head needs a parent head");
  if (!parent) throw new DomainError("HEAD_PARENT_NOT_FOUND", "Parent head not found");
  if (parent.level !== level - 1) {
    throw new DomainError("HEAD_PARENT_LEVEL_MISMATCH", "Parent head must be exactly one level above the new head");
  }
}

export type SanctionStatus = "draft" | "approved" | "exhausted" | "cancelled";

export interface BudgetAvailability {
  reMinor: bigint;
  utilisedMinor: bigint;
}

/** Returns available balance (re_minor - utilised_minor). */
export function availableBalance(b: BudgetAvailability): bigint {
  return b.reMinor - b.utilisedMinor;
}

/** Throws if bill amount exceeds available budget. */
export function assertBudgetNotExceeded(available: bigint, requested: bigint): void {
  if (requested > available) {
    throw new DomainError(
      "BUDGET_EXCEEDED",
      `requested ${requested} paise exceeds available ${available} paise`
    );
  }
}

export interface SanctionAvailability {
  amountMinor: bigint;
  utilisedMinor: bigint;
}

/** Remaining unspent balance on a sanction. */
export function sanctionAvailable(s: SanctionAvailability): bigint {
  return s.amountMinor - s.utilisedMinor;
}

export function assertSanctionNotExhausted(s: SanctionAvailability, requested: bigint): void {
  const avail = sanctionAvailable(s);
  if (requested > avail) {
    throw new DomainError(
      "SANCTION_EXHAUSTED",
      `requested ${requested} paise exceeds sanction balance ${avail} paise`
    );
  }
}

/** FY must be in YYYY-YY format, e.g. 2024-25. */
export function assertValidFY(fy: string): void {
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    throw new DomainError("INVALID_FY", `fiscal year must be YYYY-YY, got '${fy}'`);
  }
}

/**
 * GFR Rule 11: Revised Estimate (reMinor) cannot exceed Budget Estimate (beMinor).
 * Release orders must be backed by sanctioned budget — prevents over-release.
 */
export function assertReleaseWithinSanction(beMinor: bigint, newReMinor: bigint): void {
  if (newReMinor > beMinor) {
    throw new DomainError(
      "GFR_RULE_11_VIOLATION",
      `revised estimate ${newReMinor} paise exceeds budget estimate ${beMinor} paise (GFR Rule 11)`
    );
  }
}

/**
 * GFR Rule 10 — re-appropriation is a ZERO-SUM transfer: an amount withdrawn
 * from a source head's savings is added to a target head. It must be met from
 * the source head's *savings* (its unspent revised estimate), and total
 * appropriation is conserved. The receiving head's RE may legitimately exceed
 * its own BE — that is the entire purpose of re-appropriation — so the Rule-11
 * RE≤BE cap must NOT be applied to the target here.
 */
export interface ReappropriationSource {
  reMinor: bigint;       // source head revised estimate
  utilisedMinor: bigint; // already spent/committed on the source head
}
export function assertReappropriationValid(source: ReappropriationSource, amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "re-appropriation amount must be positive");
  }
  const savings = source.reMinor - source.utilisedMinor;
  if (amountMinor > savings) {
    throw new DomainError(
      "INSUFFICIENT_SAVINGS",
      `re-appropriation ${amountMinor} paise exceeds source head savings ${savings} paise (GFR Rule 10: must be met from savings)`
    );
  }
}

/**
 * R11 — maker-checker separation of duties. A sanction must be approved by an
 * officer other than the one who raised it. Self-approval (single-officer
 * sanction) is rejected so a financial commitment always has two distinct
 * accountable parties (GFR maker-checker; DFPR delegation).
 */
export function assertSanctionApproverDistinct(createdBy: string, approverId: string): void {
  if (createdBy === approverId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "sanction approver must differ from the officer who created it (maker-checker)"
    );
  }
}

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-04: LIKE pattern for the head search box.
 * `%`, `_` and `\\` typed by the user are literals, not wildcards.
 */
export function headSearchPattern(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export { assertValidPfmsHoA, assertValidDdoCode } from "../../shared/pfms.js";

export type HeadType = HeadNature;

/**
 * The accounting nature of a budget head, exactly as GET /v1/finance/accounts
 * reports it (`type`). Delegates to the shared @civitasone/schemas rule
 * (explicit nature wins; otherwise the LMMHA major-head range of the code),
 * so the accounts list, the web head pickers and the budget-estimate guard
 * below all agree.
 */
export function effectiveHeadType(classification: string | null, code: string): HeadType {
  return classifyBudgetHead({ classification, code }).type;
}

/**
 * GAP-FINANCE-BUDGET-FORMULATION-NEW-02: a Budget Estimate is an
 * appropriation for EXPENDITURE. Budget-native classifications
 * (revenue/capital/plan/nonplan) and unclassified heads are budgetable within
 * the LMMHA expenditure ranges (2xxx-7xxx); receipt heads (0xxx-1xxx), the
 * public account (8xxx) and explicit asset/liability/equity/income heads are
 * not.
 */
export function assertBudgetableHead(head: { classification: string | null; code: string }): void {
  const { type, budgetable } = classifyBudgetHead(head);
  if (!budgetable) {
    throw new DomainError(
      "HEAD_NOT_BUDGETABLE",
      `a budget estimate can only be proposed against an expenditure head (head ${head.code} is classified as ${type})`,
    );
  }
}


/** The sanction statuses the web contract knows (SanctionSummarySchema). */
export type SanctionWebStatus = "approved" | "pending" | "rejected";

const SANCTION_STATUS_TO_WEB: Record<string, SanctionWebStatus> = {
  approved: "approved",
  exhausted: "approved", // fully utilised, but it WAS approved
  rejected: "rejected",
  cancelled: "rejected", // what the sanctionReject consumer stores
  draft: "pending",
  pending: "pending",
  pending_approval: "pending", // what sanctionCreate / submit-approval store
};

/** True when the stored status is one this mapper explicitly understands. */
export function isKnownSanctionStatus(status: string): boolean {
  return Object.prototype.hasOwnProperty.call(SANCTION_STATUS_TO_WEB, status);
}

/**
 * Stored sanction status -> the approved|pending|rejected the web renders.
 * An unknown value maps to "pending" (never silently "approved"); callers log it.
 */
export function mapSanctionStatus(status: string): SanctionWebStatus {
  return isKnownSanctionStatus(status) ? (SANCTION_STATUS_TO_WEB[status] ?? "pending") : "pending";
}
