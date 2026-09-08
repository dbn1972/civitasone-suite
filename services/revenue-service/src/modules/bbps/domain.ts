/**
 * BBPS Biller domain — fetch-bill response builder and payment validation.
 *
 * STUB NOTE: Actual NPCI BBPS API integration requires biller credentials
 * (billerCode, publicKey, HMAC secret) that are not available in dev.
 * The adapter is env-gated: BBPS_ENABLED=true enables the live path.
 * Without it, the stub path returns structured errors.
 *
 * SEC-001: there is no live NPCI BBPS gateway to call out to and synchronously
 * verify a payment against in this environment. Absent that, the only trust
 * boundary available is a signed callback — mirroring
 * billing-service/src/modules/payments/razorpay.ts's `verifyWebhookSignature`
 * (HMAC-SHA256 over the raw body, timing-safe compare). `verifyBbpsCallback`
 * below is that same pattern applied to BBPS: a pay-bill claim is only ever
 * accepted once it carries a signature that only the BBPS gateway (holder of
 * BBPS_WEBHOOK_SECRET) could have produced. See routes.ts for where this is
 * enforced, and consumer.ts for why the settled amount is still re-derived
 * from the DCB record rather than trusted verbatim even after the signature
 * checks out.
 *
 * _Requirements: SVC-134_
 */

import { createHmac, timingSafeEqual } from "node:crypto";
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

function getBbpsWebhookSecret(): string {
  const secret = process.env.BBPS_WEBHOOK_SECRET;
  if (!secret) throw new Error("BBPS_WEBHOOK_SECRET is not set");
  return secret;
}

/**
 * Verify a BBPS gateway callback signature.
 *
 * HMAC-SHA256(rawBody, BBPS_WEBHOOK_SECRET) === signature (hex), timing-safe —
 * same construction as billing-service's Razorpay webhook verification. This
 * is the sole authorization boundary for POST /v1/revenue/bbps/pay-bill: the
 * route requires this to pass BEFORE the payBill command is ever published,
 * so an unsigned or forged claim never reaches the queue/consumer at all.
 */
export function verifyBbpsCallback(rawBody: string, signature: string): boolean {
  const expected = createHmac("sha256", getBbpsWebhookSecret()).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Format bigint paise to rupee string (for BBPS response).
 */
function formatRupees(paise: bigint): string {
  const rupees = paise / 100n;
  const paiseRem = paise % 100n;
  return `${rupees.toString()}.${paiseRem.toString().padStart(2, "0")}`;
}
