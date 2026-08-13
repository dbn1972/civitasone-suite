export const QUALITY_STATUSES = ["satisfactory", "unsatisfactory", "pending"] as const;
export type Quality = (typeof QUALITY_STATUSES)[number];

export const DEPOSIT_REFUND_STATUSES = ["held", "partial_refund", "full_refund", "forfeited"] as const;
export type DepositRefundStatus = (typeof DEPOSIT_REFUND_STATUSES)[number];

export function calculateRefundMinor(depositMinor: bigint, quality: string): bigint {
  if (quality === "satisfactory") return depositMinor;
  if (quality === "unsatisfactory") return 0n;
  return 0n;
}
