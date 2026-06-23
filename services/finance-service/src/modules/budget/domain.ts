/** Pure budget domain logic — no DB, no HTTP, no queue. Unit-tested in isolation. */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
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

export { assertValidPfmsHoA, assertValidDdoCode } from "../../shared/pfms.js";
