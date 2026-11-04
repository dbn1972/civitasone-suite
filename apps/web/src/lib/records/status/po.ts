import type { StatusRule } from "../statusActions";

/**
 * UX-R5 / DS-3: purchase order status rules, mirroring procurement-service po/domain.ts VALID_TRANSITIONS:
 *   draft -> pending | approved | cancelled; pending -> approved | cancelled; approved -> dispatched | closed |
 *   cancelled; gem_placed -> dispatched | closed; dispatched -> closed; closed, cancelled final.
 * The optional eOffice file note is only offered while the PO awaits its workflow approval (draft / pending).
 */
export const PO_STATUS_RULE: StatusRule = {
  terminal: ["closed", "cancelled"],
  raisable: ["draft", "pending"],
};

/** Statuses in which an amendment request fits (a real order that is not final). */
export const PO_AMENDABLE = ["approved", "dispatched", "partial_grn", "gem_placed"] as const;
