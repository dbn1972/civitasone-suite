/**
 * Billing domain — pure functions for bill generation from demands.
 *
 * Bills are generated from demand snapshots. The bill amount MUST equal
 * the demand net amount — no caller-supplied tax lines.
 *
 * _Requirements: SVC-132_
 */

import { DomainError } from "../rate-engine/domain.js";

export { DomainError };

export interface DemandForBill {
  id: string;
  assesseeId: string;
  assessmentId: string;
  rateHeadId: string;
  financialYear: string;
  dueDate: string;
  principalMinor: bigint;
  rebateMinor: bigint;
  penaltyMinor: bigint;
  netMinor: bigint;
}

export interface BillData {
  assesseeId: string;
  demandId: string;
  assessmentId: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  principalMinor: bigint;
  rebateMinor: bigint;
  penaltyMinor: bigint;
  totalMinor: bigint;
  receiptHeadCode: string;
}

/** Receipt head mapping: rate category → GL receipt head code */
const RECEIPT_HEAD_MAP: Record<string, string> = {
  property_tax: "0029-PT",
  water: "0215-WC",
  sewerage: "0215-SW",
};

/**
 * Generate a bill from a demand. The bill total MUST match the demand net.
 * No caller-supplied amounts are accepted.
 */
export function generateBillFromDemand(
  demand: DemandForBill,
  rateCategory: string,
  billSequence: number,
  billDate: string,
): BillData {
  const billNo = `BILL-${demand.financialYear}-${String(billSequence).padStart(6, "0")}`;
  const receiptHeadCode = RECEIPT_HEAD_MAP[rateCategory] ?? `0029-${rateCategory.toUpperCase().slice(0, 4)}`;

  const totalMinor = demand.principalMinor - demand.rebateMinor + demand.penaltyMinor;

  // Invariant: bill total must equal demand net
  if (totalMinor !== demand.netMinor) {
    throw new DomainError(
      "BILL_AMOUNT_MISMATCH",
      `Bill total (${totalMinor.toString()}) does not match demand net (${demand.netMinor.toString()})`,
    );
  }

  return {
    assesseeId: demand.assesseeId,
    demandId: demand.id,
    assessmentId: demand.assessmentId,
    billNo,
    billDate,
    dueDate: demand.dueDate,
    principalMinor: demand.principalMinor,
    rebateMinor: demand.rebateMinor,
    penaltyMinor: demand.penaltyMinor,
    totalMinor,
    receiptHeadCode,
  };
}

/**
 * Validate that a bill total equals the demand net (invariant check).
 */
export function assertBillMatchesDemand(billTotal: bigint, demandNet: bigint): void {
  if (billTotal !== demandNet) {
    throw new DomainError(
      "BILL_AMOUNT_MISMATCH",
      `Bill total ${billTotal.toString()} does not match demand net ${demandNet.toString()}`,
    );
  }
}
