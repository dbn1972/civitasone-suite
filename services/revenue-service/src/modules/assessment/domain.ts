/**
 * Assessment domain — pure functions for demand lifecycle and DCB invariants.
 *
 * _Requirements: SVC-131_
 */

import { DomainError, assertMakerChecker } from "../rate-engine/domain.js";

export { DomainError, assertMakerChecker };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DcbEntry {
  entryType: "demand" | "collection" | "refund" | "adjustment" | "write_off";
  amountMinor: bigint;
}

export interface DcbSummary {
  totalDemand: bigint;
  totalCollection: bigint;
  balance: bigint;
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Compute DCB summary from a list of entries.
 * Invariant: Σdemand - Σcollection = balance
 */
export function computeDcbSummary(entries: DcbEntry[]): DcbSummary {
  let totalDemand = 0n;
  let totalCollection = 0n;

  for (const entry of entries) {
    if (entry.entryType === "demand") {
      totalDemand += entry.amountMinor;
    } else {
      // collection, refund (negative refund adds back), adjustment, write_off
      totalCollection += entry.amountMinor;
    }
  }

  const balance = totalDemand - totalCollection;
  return { totalDemand, totalCollection, balance };
}

/**
 * Assert that a payment does not exceed outstanding balance.
 */
export function assertPaymentNotExceedBalance(paymentMinor: bigint, balanceMinor: bigint): void {
  if (paymentMinor > balanceMinor) {
    throw new DomainError(
      "OVERPAYMENT",
      `Payment ${paymentMinor.toString()} exceeds outstanding balance ${balanceMinor.toString()}`,
    );
  }
}

/**
 * Compute running balance after a new entry.
 */
export function computeNewBalance(currentBalance: bigint, entryType: string, amount: bigint): bigint {
  if (entryType === "demand") {
    return currentBalance + amount;
  }
  // collection, write_off, adjustment reduce balance
  return currentBalance - amount;
}

/**
 * Validate assessment revision.
 */
export function assertCanRevise(status: string): void {
  if (status !== "active") {
    throw new DomainError("INVALID_STATUS", `Cannot revise assessment in status '${status}'`);
  }
}

/**
 * Age demand into buckets: 0-30, 31-60, 61-90, >90 days.
 */
export function ageIntoBuckets(
  demands: Array<{ dueDate: string; balanceMinor: bigint }>,
  asOfDate: string,
): { bucket0_30: bigint; bucket31_60: bigint; bucket61_90: bigint; bucket90Plus: bigint } {
  const asOf = Date.parse(`${asOfDate}T00:00:00Z`);
  let bucket0_30 = 0n;
  let bucket31_60 = 0n;
  let bucket61_90 = 0n;
  let bucket90Plus = 0n;

  for (const d of demands) {
    if (d.balanceMinor <= 0n) continue;
    const due = Date.parse(`${d.dueDate}T00:00:00Z`);
    const daysOverdue = Math.max(0, Math.round((asOf - due) / 86_400_000));

    if (daysOverdue <= 30) bucket0_30 += d.balanceMinor;
    else if (daysOverdue <= 60) bucket31_60 += d.balanceMinor;
    else if (daysOverdue <= 90) bucket61_90 += d.balanceMinor;
    else bucket90Plus += d.balanceMinor;
  }

  return { bucket0_30, bucket31_60, bucket61_90, bucket90Plus };
}
