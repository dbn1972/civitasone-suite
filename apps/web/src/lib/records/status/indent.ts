import type { StatusRule } from "../statusActions";

/**
 * UX-R5 / DS-3: purchase indent status rules, mirroring procurement-service indent/domain.ts VALID_TRANSITIONS
 * (draft -> pending -> approved | rejected | tender_required; approved -> closed). The web maps pending to
 * pending_approval and has converted_to_po. Rejected, closed and converted are final; an indent awaiting a
 * decision (pending approval, tender required) is decided from the approvals queue, not raised again.
 */
export const INDENT_STATUS_RULE: StatusRule = {
  terminal: ["rejected", "closed", "converted_to_po"],
  awaiting: ["pending_approval", "pending", "tender_required"],
  raisable: [],
};
