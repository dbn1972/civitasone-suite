import type { StatusRule } from "../statusActions";

/**
 * UX-R5 / DS-3: expenditure bill status rules, mirroring finance-service payments/queries.ts mapBillStatus
 * (pending | under_review | on_hold | passed | paid | rejected). A bill is passed from pending / under review;
 * a passed bill can only be paid; paid and rejected are final. Bills have no eOffice raise of their own.
 */
export const BILL_STATUS_RULE: StatusRule = {
  terminal: ["paid", "rejected"],
  raisable: [],
};

/** Statuses in which "Pass bill" fits (server: maker-checker + 3-way match still decide). */
export const BILL_PASSABLE = ["pending", "under_review"] as const;
/** Statuses in which "Release payment" fits. */
export const BILL_PAYABLE = ["passed", "approved"] as const;
