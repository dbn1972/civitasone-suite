/**
 * Collection domain — pure functions for receipt, refund, and adjustment logic.
 *
 * _Requirements: SVC-133, SVC-135_
 */

import { DomainError, assertMakerChecker } from "../rate-engine/domain.js";

export { DomainError, assertMakerChecker };

export type Channel = "online" | "counter" | "cheque" | "dd" | "pos";

export interface ReceiptInput {
  assesseeId: string;
  demandId: string;
  amountMinor: bigint;
  channel: Channel;
  reference?: string;
  instrumentNo?: string;
  bankName?: string;
}

export interface RefundInput {
  receiptId: string;
  assesseeId: string;
  amountMinor: bigint;
  reason: string;
  makerUserId: string;
}

export interface AdjustmentInput {
  assesseeId: string;
  fromDemandId: string;
  toDemandId: string;
  amountMinor: bigint;
  reason: string;
}

/**
 * Validate receipt: amount must be positive, must not exceed demand balance.
 */
export function validateReceipt(input: ReceiptInput, demandBalance: bigint): void {
  if (input.amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Receipt amount must be positive");
  }
  if (input.amountMinor > demandBalance) {
    throw new DomainError(
      "OVERPAYMENT",
      `Receipt ${input.amountMinor.toString()} exceeds demand balance ${demandBalance.toString()}. Use credit mechanism for advance.`,
    );
  }
}

/**
 * Validate refund: amount must be positive, must not exceed original receipt.
 */
export function validateRefund(refundAmount: bigint, receiptAmount: bigint): void {
  if (refundAmount <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Refund amount must be positive");
  }
  if (refundAmount > receiptAmount) {
    throw new DomainError(
      "REFUND_EXCEEDS_RECEIPT",
      `Refund ${refundAmount.toString()} exceeds receipt ${receiptAmount.toString()}`,
    );
  }
}

/**
 * Validate adjustment: amount must be positive, from and to demands must differ.
 */
export function validateAdjustment(input: AdjustmentInput, fromBalance: bigint): void {
  if (input.amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Adjustment amount must be positive");
  }
  if (input.fromDemandId === input.toDemandId) {
    throw new DomainError("SAME_DEMAND", "Cannot adjust between the same demand");
  }
  if (input.amountMinor > fromBalance) {
    throw new DomainError(
      "ADJUSTMENT_EXCEEDS_BALANCE",
      `Adjustment ${input.amountMinor.toString()} exceeds from-demand balance ${fromBalance.toString()}`,
    );
  }
}

/**
 * Compute receipt number in format: RCT-{FY}-{SEQ:8}
 */
export function generateReceiptNo(financialYear: string, sequence: number): string {
  return `RCT-${financialYear}-${String(sequence).padStart(8, "0")}`;
}
