/**
 * GAP-HR-TRANSFER-07/08: the single source of truth for a transfer order's
 * status label, pill tone hint, and pipeline position -- matching the REAL
 * enum values services/hrms-service actually produces:
 *  - direct path (lifecycle/consumer.ts issue-order/relieve/join handlers):
 *    requested -> ordered -> relieved -> joined
 *  - eOffice-approval path (lifecycle/eoffice-consumer.ts): pending_approval
 *    -> pending_effective -> completed, or -> cancelled at any point
 *
 * TransferOrderCard/TransferListFilters previously used an invented
 * pending/initiated/hod_approved/admin_approved/order_issued/approved
 * vocabulary with no corresponding backend transition at all -- e.g. "Issue
 * Order" only ever showed for status "pending"/"initiated", but POST
 * /transfers actually creates status "requested", so that button never
 * appeared for a freshly-created transfer.
 */

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  ordered: "Order Issued",
  relieved: "Relieved",
  joined: "Joined",
  pending_approval: "Pending Approval",
  pending_effective: "Approved — Effective Soon",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function transferStatusLabel(status: string): string {
  return TRANSFER_STATUS_LABEL[status] ?? status;
}

/** True for a status produced by the eOffice-approval path, which doesn't
 * advance through the direct-path numbered pipeline below (it has its own,
 * simpler approve/effective/cancel shape) -- rendered as plain status text
 * instead. */
export function isEofficeStatus(status: string): boolean {
  return status === "pending_approval" || status === "pending_effective" || status === "completed";
}

/** The direct (non-eOffice) pipeline, in order. */
export const DIRECT_PIPELINE: ReadonlyArray<{ key: string; label: string }> = [
  { key: "requested", label: TRANSFER_STATUS_LABEL.requested },
  { key: "ordered", label: TRANSFER_STATUS_LABEL.ordered },
  { key: "relieved", label: TRANSFER_STATUS_LABEL.relieved },
  { key: "joined", label: TRANSFER_STATUS_LABEL.joined },
];

const DIRECT_PIPELINE_INDEX: Record<string, number> = {
  requested: 0,
  ordered: 1,
  relieved: 2,
  joined: 3,
};

export function directPipelineIndex(status: string): number {
  return DIRECT_PIPELINE_INDEX[status] ?? 0;
}
