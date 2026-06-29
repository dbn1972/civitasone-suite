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
