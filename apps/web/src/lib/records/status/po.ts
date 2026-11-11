import type { StatusRule } from "../statusActions";

/**
 * UX-R5 / DS-3: purchase order status rules, mirroring procurement-service po/domain.ts VALID_TRANSITIONS:
 *   draft -> pending | approved | cancelled; pending -> approved | cancelled; approved -> dispatched | closed |
 *   cancelled; gem_placed -> dispatched | closed; dispatched -> closed; closed, cancelled, rejected final (UAT bundle 22 W2: a checker's reject ends the PO rejected).
 * The optional eOffice file note is only offered on a draft PO. `pending` is already in its approval: there is no
 * pending -> pending transition (the submit consumer asserts it), so raising would open a second eOffice file and
 * queue a command that can only fail.
 */
export const PO_STATUS_RULE: StatusRule = {
  terminal: ["closed", "cancelled", "rejected"],
  raisable: ["draft"],
  awaiting: ["pending"],
};

/** Statuses in which an amendment request fits (a real order that is not final). */
export const PO_AMENDABLE = ["approved", "dispatched", "partial_grn", "gem_placed"] as const;
