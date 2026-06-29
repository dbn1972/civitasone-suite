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

export { assertValidPfmsHoA, assertValidDdoCode } from "../../shared/pfms.js";
