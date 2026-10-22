/**
 * GAP-HR-DPC-02: which promotion statuses the DPC page's batch card shows, and
 * how the card's stat tiles bucket them.
 *
 * The card used to request `?status=pending` -- an exact match on a status that
 * no live write path ever creates (lifecycle/consumer.ts writes completed /
 * pending_effective, the eOffice submit writes pending_approval), so the card
 * was always empty -- and its tiles ignored pending_approval / pending_effective
 * altogether. The real vocabulary is lifecycle.hrms_promotions_status_check
 * (migration 0144): pending, approved, rejected, cancelled, pending_approval,
 * completed, pending_effective (plus the legacy dept/hr/finance_approved and
 * signed values older rows can still carry, which PromotionCard folds in).
 *
 * "In flight" = raised but not yet effective: those are the promotions a DPC
 * round is still acting on. There is no DPC-batch id in the schema, so this is
 * the closest honest scope; the page says so (dpc.batchScopeNote).
 */
export const DPC_IN_FLIGHT_STATUSES = ["pending", "pending_approval", "pending_effective", "approved"] as const;

export type PromotionBuckets = {
  initiated: number;
  inApproval: number;
  awaitingEffective: number;
  signed: number;
  cancelled: number;
  /** Anything not recognised above, so the buckets always add up to the total. */
  other: number;
};

const IN_APPROVAL = ["pending_approval", "dept_approved", "hr_approved", "finance_approved", "approved"];
const SIGNED = ["signed", "completed"];
const CANCELLED = ["cancelled", "rejected"];

export function bucketPromotions(promotions: ReadonlyArray<{ status: string }>): PromotionBuckets {
  const b: PromotionBuckets = { initiated: 0, inApproval: 0, awaitingEffective: 0, signed: 0, cancelled: 0, other: 0 };
  for (const { status } of promotions) {
    if (status === "pending") b.initiated++;
    else if (IN_APPROVAL.includes(status)) b.inApproval++;
    else if (status === "pending_effective") b.awaitingEffective++;
    else if (SIGNED.includes(status)) b.signed++;
    else if (CANCELLED.includes(status)) b.cancelled++;
    else b.other++;
  }
  return b;
}
