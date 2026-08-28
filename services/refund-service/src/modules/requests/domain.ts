export const REQUEST_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "processing",
  "refunded",
  "failed",
  "withdrawn",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, RequestStatus[]> = {
  requested: ["under_review", "rejected", "withdrawn"],
  // A processing-level `return` (see processing/consumer.ts returnRequest)
  // sends a request back from under_review to requested for correction.
  under_review: ["approved", "rejected", "requested", "withdrawn"],
  approved: ["processing"],
  processing: ["refunded", "failed"],
  rejected: [],
  refunded: [],
  // A failed disbursement can be retried: reconciliation/routes.ts allows a
  // fresh disbursement to be initiated from status "failed", moving it back
  // to "processing".
  failed: ["processing"],
  withdrawn: [],
};

export function canTransition(from: string, to: RequestStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const REFUND_REASONS = [
  "overpayment",
  "cancellation",
  "deposit_return",
  "duplicate_payment",
  "other",
] as const;

export function validateRefundAmount(refundAmountMinor: bigint, originalAmountMinor: bigint): boolean {
  return refundAmountMinor > 0n && refundAmountMinor <= originalAmountMinor;
}

export function generateRequestNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `REF/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
