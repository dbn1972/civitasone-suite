export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * DOM-011: matches the CHECK constraint already on rfq.procurement_rfqs.status
 * (migration 0015: `CHECK (status IN ('draft','issued','closed','cancelled','awarded'))`)
 * and the enum already declared by packages/schemas/src/web.ts's
 * RFQSummarySchema/RFQDetailSchema -- both predated DOM-011 and were unused
 * until now (the consumer always created an RFQ directly in 'issued' with no
 * further transition ever available).
 */
export type RfqStatus = "draft" | "issued" | "closed" | "cancelled" | "awarded";

// `draft` is reachable only in principle -- rfq/consumer.ts's registerRfqConsumers
// creates every RFQ directly as 'issued'. Kept in the state machine (rather than
// omitted) because it is part of the shared status contract every caller of
// packages/schemas/src/web.ts already types against.
const VALID_TRANSITIONS: Record<RfqStatus, RfqStatus[]> = {
  draft:     ["issued", "cancelled"],
  issued:    ["closed", "cancelled"],
  closed:    ["awarded", "cancelled"],
  awarded:   [],
  cancelled: [],
};

export function assertRfqTransition(from: string, to: RfqStatus): void {
  const allowed = VALID_TRANSITIONS[from as RfqStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `RFQ cannot transition from '${from}' to '${to}'`);
  }
}

/**
 * Segregation of duties: the award approver (checker) must differ from the
 * RFQ creator (maker). Mirrors po/domain.ts's assertDistinctMakerChecker and
 * tender/domain.ts's identically-named function exactly -- the same
 * convention already applied to PO approval and tender award, now extended
 * to the one procurement instrument that didn't have it yet.
 */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "RFQ creator cannot also award the RFQ (self-award rejected)");
  }
}

export interface RfqResponseItem {
  itemId?: string;
  itemName?: string;
  unitPrice: number;
  leadTimeDays?: number;
  notes?: string;
}

/**
 * Server-side total for a vendor's response -- never trusted from the client.
 * When a response line references a real RFQ item (`itemId` resolves), the
 * line contributes `unitPrice * that item's quantity`; rfqRespondBody also
 * allows a line identified only by `itemName` (a vendor-proposed substitute
 * not on the original list) with no quantity to resolve against, which
 * contributes `unitPrice` at an implied quantity of 1 -- documented here
 * rather than silently guessed, since it is the one place this computation
 * cannot derive a real quantity from existing data.
 */
export function computeResponseTotalMinor(
  items: RfqResponseItem[],
  rfqItemQtyById: ReadonlyMap<string, number>,
): bigint {
  let totalMinor = 0n;
  for (const item of items) {
    const qty = item.itemId != null ? (rfqItemQtyById.get(item.itemId) ?? 1) : 1;
    totalMinor += BigInt(Math.round(item.unitPrice * 100)) * BigInt(qty);
  }
  return totalMinor;
}
