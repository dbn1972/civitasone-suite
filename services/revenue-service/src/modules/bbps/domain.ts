/**
 * BBPS Biller domain — fetch-bill response builder and payment validation.
 *
 * STUB NOTE: Actual NPCI BBPS API integration requires biller credentials
 * (billerCode, publicKey, HMAC secret) that are not available in dev.
 * The adapter is env-gated: BBPS_ENABLED=true enables the live path.
 * Without it, the stub path returns structured errors.
 *
 * _Requirements: SVC-134_
 */

import { DomainError } from "../rate-engine/domain.js";

export { DomainError };

export interface BbpsFetchBillResponse {
  customerName: string;
  billAmount: string; // rupees (BBPS standard)
  billAmountMinor: bigint;
  billDate: string;
  dueDate: string;
  billNumber: string;
}

export interface DcbOutstanding {
  assesseeId: string;
  ownerName: string;
  totalOutstandingMinor: bigint;
  oldestDueDate: string;
  demandCount: number;
}

/**
 * Build BBPS fetch-bill response from DCB outstanding data.
 */
export function buildFetchBillResponse(dcb: DcbOutstanding, billDate: string): BbpsFetchBillResponse {
  if (dcb.totalOutstandingMinor <= 0n) {
    throw new DomainError("NO_OUTSTANDING", "No outstanding balance for this assessee");
  }

  return {
    customerName: dcb.ownerName,
    billAmount: formatRupees(dcb.totalOutstandingMinor),
    billAmountMinor: dcb.totalOutstandingMinor,
    billDate,
    dueDate: dcb.oldestDueDate,
    billNumber: `BBPS-${dcb.assesseeId.slice(0, 8).toUpperCase()}`,
  };
}

/**
 * Validate BBPS payment amount: must be positive, cannot exceed outstanding.
 */
export function validateBbpsPayment(paymentMinor: bigint, outstandingMinor: bigint): void {
  if (paymentMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "BBPS payment amount must be positive");
  }
  if (paymentMinor > outstandingMinor) {
    throw new DomainError(
      "BBPS_OVERPAYMENT",
      `BBPS payment ${paymentMinor.toString()} exceeds outstanding ${outstandingMinor.toString()}`,
    );
  }
}

/**
 * Check whether BBPS is enabled via environment variable.
 * In production, BBPS_ENABLED must be explicitly set to "true" with proper credentials.
 */
export function isBbpsEnabled(): boolean {
  return process.env.BBPS_ENABLED === "true";
}

/**
 * Format bigint paise to rupee string (for BBPS response).
 */
function formatRupees(paise: bigint): string {
  const rupees = paise / 100n;
  const paiseRem = paise % 100n;
  return `${rupees.toString()}.${paiseRem.toString().padStart(2, "0")}`;
}
