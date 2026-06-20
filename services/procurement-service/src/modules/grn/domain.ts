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
  return items.every((i) => i.receivedQty >= i.orderedQty && i.acceptedQty >= i.orderedQty);
}

export function assertQtyValid(items: GrnItem[]): void {
  for (const item of items) {
    if (item.receivedQty < 0 || item.acceptedQty < 0) {
      throw new DomainError("INVALID_QTY", "received and accepted quantities must be non-negative");
    }
    if (item.acceptedQty > item.receivedQty) {
      throw new DomainError("INVALID_QTY", "accepted quantity cannot exceed received quantity");
    }
  }
}
