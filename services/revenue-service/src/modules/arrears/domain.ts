/**
 * Arrears & Recovery domain — pure functions for ageing, instalment plans,
 * write-offs, and legal referrals.
 *
 * _Requirements: SVC-137_
 */

import { DomainError, assertMakerChecker } from "../rate-engine/domain.js";

export { DomainError, assertMakerChecker };

export interface InstalmentScheduleEntry {
  sequenceNo: number;
  dueDate: string;
  amountMinor: bigint;
}

/**
 * Generate instalment schedule: splits total evenly across N months.
 * Last instalment absorbs any rounding remainder.
 */
export function generateInstalmentSchedule(
  totalMinor: bigint,
  instalmentCount: number,
  startDate: string,
): InstalmentScheduleEntry[] {
  if (totalMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Instalment total must be positive");
  }
  if (instalmentCount < 2 || instalmentCount > 36) {
    throw new DomainError("INVALID_COUNT", "Instalment count must be between 2 and 36");
  }

  const perInstalment = totalMinor / BigInt(instalmentCount);
  const remainder = totalMinor - perInstalment * BigInt(instalmentCount);
  const entries: InstalmentScheduleEntry[] = [];

  for (let i = 0; i < instalmentCount; i++) {
    const date = addMonths(startDate, i);
    const amount = i === instalmentCount - 1 ? perInstalment + remainder : perInstalment;
    entries.push({ sequenceNo: i + 1, dueDate: date, amountMinor: amount });
  }

  return entries;
}

/**
 * Validate write-off: amount positive, does not exceed outstanding.
 */
export function validateWriteOff(amount: bigint, outstanding: bigint): void {
  if (amount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Write-off amount must be positive");
  }
  if (amount > outstanding) {
    throw new DomainError(
      "WRITEOFF_EXCEEDS_OUTSTANDING",
      `Write-off ${amount.toString()} exceeds outstanding ${outstanding.toString()}`,
    );
  }
}

/** Waivable component(s) of a demand selected on a waiver request. */
export type WaiverComponent = "penalty" | "interest" | "both";

/**
 * The server-authoritative cap for a waiver against a demand. A waiver forgives
 * accrued penalty and/or interest (never principal), so the cap is the chosen
 * component's outstanding amount on that demand: `penalty`, `interest`, or
 * their sum for `both`. Mirrors the web WaiverForm `capFor` helper
 * (GAP-REVENUE-WAIVERS-01) so the server enforces the same ceiling the UI shows.
 */
export function waiverCap(
  component: WaiverComponent,
  penaltyMinor: bigint,
  interestMinor: bigint,
): bigint {
  if (component === "penalty") return penaltyMinor;
  if (component === "interest") return interestMinor;
  return penaltyMinor + interestMinor; // both
}

/**
 * GAP-REVENUE-WAIVERS-01 (server-side cap): validate a waiver amount against the
 * waivable cap of its demand. Previously the penalty/interest cap was enforced
 * ONLY in the web form, so a crafted API request could waive more than the
 * demand's accrued penalty/interest (even negative or over-cap amounts). The
 * command consumer is the authority: the amount must be strictly positive and
 * must not exceed `cap` (the penalty/interest component[s] being waived).
 */
export function validateWaiver(amount: bigint, cap: bigint): void {
  if (amount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Waiver amount must be positive");
  }
  if (amount > cap) {
    throw new DomainError(
      "WAIVER_EXCEEDS_CAP",
      `Waiver ${amount.toString()} exceeds waivable amount ${cap.toString()}`,
    );
  }
}

/**
 * GAP-REVENUE-RECOVERY-01: a coercive recovery referral may only be raised
 * against an assessee that actually has outstanding (overdue) arrears. Fail
 * closed — never refer a citizen with nothing owing (wrongful coercive action
 * / legal liability). `outstanding` is the assessee's current DCB balance in
 * paise; it must be strictly positive.
 */
export function validateRecoveryReferral(outstanding: bigint): void {
  if (outstanding <= 0n) {
    throw new DomainError(
      "NO_OVERDUE_ARREARS",
      "Recovery referral requires outstanding arrears; this assessee has none",
    );
  }
}

/**
 * Add N months to a date string (YYYY-MM-DD).
 */
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
