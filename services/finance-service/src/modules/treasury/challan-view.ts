import type { ChallanWithHead } from "./repo.js";

/**
 * Wire shape of a challan for the register list and the detail route.
 * receiptHeadCode / receiptHeadName come from the budget head the challan books
 * to (GAP-FINANCE-REVENUE-CHALLANS-02 / DETAIL-03); both are null when the head
 * row cannot be resolved, so the UI shows a dash rather than the raw uuid.
 */
export function challanView({ challan: r, headCode, headName }: ChallanWithHead) {
  return {
    id: r.id, challanNo: r.challanNo, receiptHeadId: r.receiptHeadId,
    receiptHeadCode: headCode, receiptHeadName: headName,
    depositor: r.depositor, amountMinor: r.amountMinor.toString(), currency: r.currency,
    grnNo: r.grnNo, status: r.status,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), version: r.version,
  };
}
