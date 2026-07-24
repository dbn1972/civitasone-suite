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

/**
 * Add N months to a date string (YYYY-MM-DD).
 */
export function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
