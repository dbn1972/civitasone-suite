/**
 * GAP-NOTIFICATIONS-DELIVERIES-02: delivery status groups.
 *
 * The deliveries list stats and tabs used to match exact statuses
 * ("delivered"/"failed"/"pending") while StatusBadge also knows sent, queued,
 * bounced and skipped — so those rows counted only in Total and appeared in no
 * tile and no tab. These groups collapse the raw statuses into the three
 * buckets a clerk reasons about, so every row lands in exactly one tile and the
 * tiles sum to Total. Bounced is grouped with Failed (it is resendable from the
 * detail page), queued with Pending, sent with Delivered.
 *
 * `skipped` (a consent/opt-out refusal) is deliberately its own terminal state:
 * it is neither a success nor a failure, so it is NOT folded into any of the
 * three actionable buckets — it shows in Total only, by design.
 */
export type DeliveryStatusGroup = "delivered" | "pending" | "failed";

const GROUP_MEMBERS: Record<DeliveryStatusGroup, readonly string[]> = {
  delivered: ["delivered", "sent"],
  pending: ["pending", "queued"],
  failed: ["failed", "bounced"],
};

/** The group a raw status belongs to, or null when it is in no actionable group (e.g. "skipped"). */
export function deliveryStatusGroup(status: string): DeliveryStatusGroup | null {
  const key = String(status ?? "").toLowerCase();
  for (const group of Object.keys(GROUP_MEMBERS) as DeliveryStatusGroup[]) {
    if (GROUP_MEMBERS[group].includes(key)) return group;
  }
  return null;
}

/** True when `status` belongs to `group` (used by the stat tiles and tab filters). */
export function isInDeliveryGroup(status: string, group: DeliveryStatusGroup): boolean {
  return deliveryStatusGroup(status) === group;
}
