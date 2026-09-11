/**
 * Trade License domain guards.
 * _Requirements: SVC-TL-01_
 */
import { DomainError } from "../rate-engine/domain.js";

export { DomainError };

/**
 * Over-payment guard: a trade-license payment receipt may not push
 * feePaidMinor past feeMinor (the assessed fee). Mirrors the same guard
 * already enforced for property-tax receipts (collection/domain.ts
 * validateReceipt) and municipal bills (billing-service
 * invoices/domain.ts assertWithinOutstanding) — TX-008: this consumer used
 * to add the client-submitted amountMinor to feePaidMinor with no cap at
 * all, so a client could "pay" any amount, including far more than the
 * license actually owed.
 */
export function assertPaymentWithinOutstanding(feeMinor: bigint, feePaidMinor: bigint, amountMinor: bigint): void {
  if (amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Payment amount must be positive");
  }
  const outstanding = feeMinor - feePaidMinor;
  if (amountMinor > outstanding) {
    throw new DomainError(
      "OVERPAYMENT",
      `Payment ${amountMinor.toString()} paise exceeds outstanding ${outstanding.toString()} paise on trade license fee`,
    );
  }
}
