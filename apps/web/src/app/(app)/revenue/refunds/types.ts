/**
 * Revenue refund status literals — the authoritative values come from
 * revenue-service collection.refunds.status (default "pending"):
 *   pending | approved | rejected | processed
 * (services/revenue-service/src/modules/collection/schema.ts).
 *
 * GAP-REVENUE-REFUNDS-DETAIL-DECIDE-02: the decide form must only offer
 * Approve/Reject while the refund is still pending; exported here so the one
 * "pending" literal is not re-guessed inline per component.
 */
export const REFUND_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  processed: "processed",
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

export function isRefundPending(status: string | null | undefined): boolean {
  return status === REFUND_STATUS.pending;
}
