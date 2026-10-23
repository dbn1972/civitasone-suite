/**
 * Assessment domain — pure functions for demand lifecycle and DCB invariants.
 *
 * _Requirements: SVC-131_
 */

import { DomainError, assertMakerChecker } from "../rate-engine/domain.js";

export { DomainError, assertMakerChecker };

// ── Types ─────────────────────────────────────────────────────────────────────

export type DcbEntryType = "demand" | "collection" | "refund" | "adjustment" | "write_off" | "waiver";

export interface DcbEntry {
  entryType: DcbEntryType;
  amountMinor: bigint;
  /**
   * Needed only to tell the two legs of an `adjustment` apart (the credit leg
   * is written with a narration starting "Adjustment credit"). Optional so
   * every other entry type classifies from `entryType` alone.
   */
  narration?: string | null;
}

/**
 * Signed effect of ONE ledger entry on the outstanding balance (positive
 * RAISES what is owed, negative reduces it), classified by entry type:
 *   - demand        raises the balance
 *   - refund        raises the balance (money returned to the payer re-opens
 *                   the liability the collection had cleared)
 *   - collection    reduces it
 *   - write_off     reduces it
 *   - waiver        reduces it
 *   - adjustment    TWO legs of equal amount: the credit leg (target demand)
 *                   raises, the debit leg (source demand) reduces. The leg is
 *                   identified by the narration the writer stamps on it;
 *                   anything not marked as a credit is the debit leg.
 * Unknown types fall back to the historical behaviour (reduce).
 */
export function dcbBalanceEffect(entry: {
  entryType: string;
  amountMinor: bigint;
  narration?: string | null;
}): bigint {
  switch (entry.entryType) {
    case "demand":
      return entry.amountMinor;
    case "refund":
      // Always raises the balance. The consumer writes a positive amount; a
      // negative-signed refund (older fixtures/imports) means the same thing.
      return entry.amountMinor < 0n ? -entry.amountMinor : entry.amountMinor;
    case "adjustment":
      return (entry.narration ?? "").startsWith("Adjustment credit") ? entry.amountMinor : -entry.amountMinor;
    default:
      return -entry.amountMinor;
  }
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
      // Every other entry is a balance movement; collected is the NET of the
      // balance-reducing flows (collection/write_off/waiver/adjustment debit)
      // less the balance-raising ones (refund, adjustment credit), so a refund
      // lifts the balance and an adjustment's two equal legs net to zero.
      totalCollection -= dcbBalanceEffect(entry);
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
export function computeNewBalance(
  currentBalance: bigint,
  entryType: string,
  amount: bigint,
  narration: string | null = null,
): bigint {
  return currentBalance + dcbBalanceEffect({ entryType, amountMinor: amount, narration });
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
