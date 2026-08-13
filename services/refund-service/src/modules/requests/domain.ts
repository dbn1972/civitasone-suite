export const REQUEST_STATUSES = [
  "requested",
  "under_review",
  "approved",
  "rejected",
  "processing",
  "refunded",
  "failed",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, RequestStatus[]> = {
  requested: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["processing"],
  processing: ["refunded", "failed"],
  rejected: [],
  refunded: [],
  failed: ["processing"],
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
