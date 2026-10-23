/**
 * GAP-FINANCE-PAYMENTS-01: UI-side segregation-of-duties hint for releasing a payment.
 *
 * finance-service refuses a payment released by the officer who CREATED the bill
 * (MAKER_CHECKER_VIOLATION) or who PASSED it (PAYER_IS_PASSER), in both the route
 * pre-check and the initiate consumer. That stays the only authority. This helper
 * only lets the UI stop offering "Release payment" / listing the bill to an officer
 * the server would turn away, so they are not invited into a guaranteed refusal.
 *
 * Fails open: with no known viewer id (not signed in / token without `sub`) or no
 * actor ids on the bill (an older server), nothing is hidden and the server decides.
 */
export interface BillActors {
  /** Actor id of the bill's creator (maker). */
  createdBy?: string | undefined;
  /** Actor id of the officer who passed the bill, while it is passed. */
  passedBy?: string | undefined;
}

export type PayerBlock = "creator" | "passer";

/** Why the signed-in user may not release a payment for this bill, or null when nothing blocks them. */
export function payerBlock(bill: BillActors, viewerId: string | null | undefined): PayerBlock | null {
  if (!viewerId) return null;
  if (bill.createdBy && bill.createdBy === viewerId) return "creator";
  if (bill.passedBy && bill.passedBy === viewerId) return "passer";
  return null;
}
