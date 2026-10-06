/**
 * Shared purchase-order and GRN status label maps.
 *
 * GAP-PROCUREMENT-ORDERS-05 / GAP-PROCUREMENT-ORDERS-DETAIL-05: the list page
 * (OrdersTable) and the detail page each kept their own private STATUS_LABELS
 * object. They had drifted — the detail page's map lacked `gem_placed`, so a
 * GeM-placed PO rendered the raw key `gem_placed` on the detail screen while
 * the list showed "GeM Placed". GRN status was printed raw ("partial") on the
 * list with no mapping at all. Both now import from here so they can never
 * disagree again.
 */

/** Human labels for a PO's lifecycle status. Covers every status the API emits. */
export const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending Approval",
  approved: "Approved",
  dispatched: "Dispatched",
  partial_grn: "Partial GRN",
  fully_received: "Fully Received",
  cancelled: "Cancelled",
  gem_placed: "GeM Placed",
  closed: "Closed",
};

/** Map a raw PO status to its label, falling back to the raw key. */
export function poStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return PO_STATUS_LABELS[status] ?? status;
}

/**
 * Human labels for GRN (goods-receipt) status as surfaced on a PO row. Shared
 * with the GRN pages' vocabulary (pending / partial / complete) so the two
 * never diverge.
 */
export const GRN_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  partial: "Partially received",
  partial_grn: "Partially received",
  complete: "Fully received",
  completed: "Fully received",
  fully_received: "Fully received",
  received: "Received",
  rejected: "Rejected",
};

/** Map a raw GRN status to its label; `null`/absent renders "—". */
export function grnStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return GRN_STATUS_LABELS[status.toLowerCase()] ?? status;
}

/**
 * PO statuses that represent a real financial commitment to a vendor. Used to
 * compute "Committed value" (GAP-PROCUREMENT-ORDERS-02): draft and cancelled
 * POs must NOT inflate committed spend.
 */
export const COMMITTED_PO_STATUSES = new Set<string>([
  "approved",
  "dispatched",
  "partial_grn",
  "fully_received",
  "gem_placed",
]);

/** True when a PO's delivery is overdue: past the delivery date and not terminal. */
export function isDeliveryOverdue(
  deliveryDate: string | null | undefined,
  status: string | null | undefined,
  todayIso: string,
): boolean {
  if (!deliveryDate) return false;
  const bare = deliveryDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bare)) return false;
  if (status === "fully_received" || status === "cancelled" || status === "closed") return false;
  return bare < todayIso;
}
