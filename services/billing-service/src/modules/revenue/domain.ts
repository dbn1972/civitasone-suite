/**
 * Revenue Recognition — Pure Domain Logic
 *
 * Implements straight-line daily accrual using bigint paise arithmetic.
 * No floating-point operations are used. All monetary values are BigInt.
 *
 * Key Invariants:
 * - sum(dailyAccruals(total, days)) === total (exactly, no rounding loss)
 * - recognizedPaise + deferredPaise === totalAmountPaise (at all times)
 */

/**
 * Computes straight-line daily accrual amounts over a service period.
 * Integer division remainder is applied to the last day to maintain the invariant
 * that sum of all accruals === totalPaise exactly.
 *
 * @param totalPaise - Total subscription amount in paise (bigint)
 * @param totalDays - Number of days in the service period (must be >= 1)
 * @returns Array of daily accrual amounts (length === totalDays)
 * @throws Error if totalDays < 1 or totalPaise < 0
 */
export function dailyAccruals(totalPaise: bigint, totalDays: number): bigint[] {
  if (totalDays < 1) {
    throw new Error("totalDays must be at least 1");
  }
  if (totalPaise < 0n) {
    throw new Error("totalPaise must be non-negative");
  }
  if (totalPaise === 0n) {
    return Array(totalDays).fill(0n) as bigint[];
  }

  const bigDays = BigInt(totalDays);
  const daily = totalPaise / bigDays;
  const remainder = totalPaise - daily * bigDays;

  const accruals: bigint[] = new Array(totalDays);
  for (let i = 0; i < totalDays - 1; i++) {
    accruals[i] = daily;
  }
  // Last day gets the daily amount plus any remainder from integer division
  accruals[totalDays - 1] = daily + remainder;

  return accruals;
}

/**
 * Computes the deferred (unearned) revenue balance.
 * Invariant: deferred = total - recognized (always non-negative when valid).
 *
 * @param totalPaise - Total invoiced amount in paise
 * @param recognizedPaise - Revenue recognized so far in paise
 * @returns Deferred revenue balance in paise
 */
export function computeDeferredBalance(totalPaise: bigint, recognizedPaise: bigint): bigint {
  return totalPaise - recognizedPaise;
}

/**
 * Computes the number of calendar days between two dates (inclusive of start, exclusive of end).
 * Used to determine totalDays for the service period.
 *
 * @param start - Service period start date (ISO string or Date)
 * @param end - Service period end date (ISO string or Date)
 * @returns Number of days in the period
 */
export function computeTotalDays(start: string | Date, end: string | Date): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const diffMs = endMs - startMs;
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  return days < 1 ? 1 : days;
}

/**
 * Revenue ledger status values.
 */
export type RevenueLedgerStatus = "active" | "completed" | "cancelled";

/**
 * Determines if a ledger is fully recognized (all deferred revenue has been earned).
 */
export function isFullyRecognized(recognizedPaise: bigint, totalPaise: bigint): boolean {
  return recognizedPaise >= totalPaise;
}

/**
 * View type for API responses.
 */
export interface RevenueLedgerView {
  id: string;
  tenantId: string;
  subscriptionId: string;
  totalAmountPaise: string; // serialized bigint
  servicePeriodStart: string;
  servicePeriodEnd: string;
  totalDays: number;
  recognizedPaise: string;
  deferredPaise: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevenueAccrualView {
  id: string;
  ledgerId: string;
  accrualDate: string;
  amountPaise: string;
  createdAt: string;
}
