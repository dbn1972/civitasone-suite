export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export interface GrnItem {
  orderedQty: number;
  receivedQty: number;
  acceptedQty: number;
}

export function computeThreeWayMatch(items: GrnItem[], inspectionResult: string): boolean {
  if (inspectionResult !== "pass") return false;
  if (items.length === 0) return false;
  // R18 — partial / part-supply deliveries are valid. A GRN records what was
  // received THIS time; the PO stays open for the balance. So the match no
  // longer demands receivedQty >= orderedQty. Each line must stay within PO
  // bounds (accepted <= received, and <= ordered when the line is priced), and
  // over-acceptance is rejected. The GRN must accept a positive total — an empty
  // receipt is not a match.
  const withinBounds = items.every((i) =>
    i.acceptedQty >= 0 &&
    i.acceptedQty <= i.receivedQty &&
    (i.orderedQty <= 0 || i.acceptedQty <= i.orderedQty)
  );
  const totalAccepted = items.reduce((sum, i) => sum + i.acceptedQty, 0);
  return withinBounds && totalAccepted > 0;
}

export function assertQtyValid(items: GrnItem[]): void {
  for (const item of items) {
    if (item.receivedQty < 0 || item.acceptedQty < 0) {
      throw new DomainError("INVALID_QTY", "received and accepted quantities must be non-negative");
    }
    if (item.acceptedQty > item.receivedQty) {
      throw new DomainError("INVALID_QTY", "accepted quantity cannot exceed received quantity");
    }
    // Over-accept cap (#19): cannot accept more than was ordered on the PO line.
    if (item.orderedQty > 0 && item.acceptedQty > item.orderedQty) {
      throw new DomainError("OVER_ACCEPT", "accepted quantity cannot exceed ordered quantity");
    }
  }
}

/**
 * SVC/GRN-amend (Req 1.2): a GRN may only be amended (partial-delivery qty
 * correction) while it is still in `draft` or `under_inspection`. Once a
 * three-way-match decision has been recorded (`accepted` / `rejected` /
 * `partial`), the GRN is immutable — amending it after acceptance would let a
 * store officer silently rewrite a financial record the payment gate already
 * relied on. `partial` is the historical column-check name for a rejected
 * three-way-match outcome (see migration 0015) and is likewise terminal.
 */
export function canAmendGrn(grn: { status: string }): boolean {
  return grn.status === "draft" || grn.status === "under_inspection";
}

/** Defense-in-depth: the consumer re-checks amendability under the DB lock,
 * since the route-level check and the consumer write are not atomic. */
export function assertGrnAmendable(grn: { status: string }): void {
  if (!canAmendGrn(grn)) {
    throw new DomainError("GRN_NOT_AMENDABLE", `GRN in status '${grn.status}' cannot be amended`);
  }
}

/**
 * DOM-002 — a GRN line must reference a real PO line. `orderedQty` can only
 * be re-derived server-side (never trusted from the client) when every
 * `poItemRef` on the payload actually resolves against the PO's items; an
 * unresolved ref is rejected outright rather than silently falling back to
 * "unbounded" (orderedQty <= 0 disables the over-accept cap in
 * assertQtyValid/computeThreeWayMatch — the same shape as the :156 bypass).
 */
export function assertPoItemsResolved(refs: string[], resolved: ReadonlySet<string>): void {
  for (const ref of refs) {
    if (!resolved.has(ref)) {
      throw new DomainError("PO_ITEM_NOT_FOUND", `po item '${ref}' not found on the referenced purchase order`);
    }
  }
}

/**
 * DOM-002 — amend must re-derive orderedQty from the GRN line actually
 * persisted at create time (itself now PO-derived), never from the client.
 * A lineId that doesn't belong to this GRN is rejected rather than silently
 * skipped, matching assertPoItemsResolved's stance on unresolved refs.
 */
export function assertGrnLinesResolved(lineIds: string[], known: ReadonlySet<string>): void {
  for (const id of lineIds) {
    if (!known.has(id)) {
      throw new DomainError("GRN_ITEM_NOT_FOUND", `grn line '${id}' does not belong to this GRN`);
    }
  }
}

/**
 * DOM-002 — a GRN can only be inspected (accepted/rejected) while it is
 * genuinely awaiting inspection. grnCreate persists new GRNs directly into
 * `under_inspection` (see grn/consumer.ts) — this is the real, reachable
 * pending state a GRN sits in between being received and being inspected,
 * not a dead status only reachable by direct SQL insert in tests. Mirrors
 * assertGrnAmendable's shape/DoD.
 */
export function canInspectGrn(grn: { status: string }): boolean {
  return grn.status === "draft" || grn.status === "under_inspection";
}

/** Defense-in-depth: the consumer re-checks inspectability under the DB
 * lock, since the route-level check and the consumer write are not atomic. */
export function assertGrnInspectable(grn: { status: string }): void {
  if (!canInspectGrn(grn)) {
    throw new DomainError("GRN_NOT_INSPECTABLE", `GRN in status '${grn.status}' cannot be inspected`);
  }
}

/**
 * DOM-002 — separation of duties: the actor who received the goods (the GRN
 * creator, `receivedBy` — persisted as `grn.createdBy` from the CREATE
 * call's own `msg.actorId`) must not be the same actor who inspects/accepts
 * or rejects them (`inspectorId` — the ACCEPT/REJECT call's own
 * `ctx.actorId`/`msg.actorId`). Both identities come from each call's own
 * independent authentication — never from a client-supplied field in either
 * request body — so this is a genuine two-person check, not a same-request
 * string comparison. Mirrors po/amendment-domain.ts's
 * assertDistinctMakerChecker (same SOD_VIOLATION code), the established
 * maker-checker convention elsewhere in this service.
 */
export function assertDistinctReceiverInspector(receivedBy: string, inspectorId: string): void {
  if (receivedBy && inspectorId && receivedBy === inspectorId) {
    throw new DomainError("SOD_VIOLATION", "receiver and inspector must be different actors (self-inspection rejected)");
  }
}
