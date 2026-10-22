import { formatEntityRef } from "@/lib/formatters";
import { opaqueRefHref } from "@/lib/refs";

/**
 * GAP-FINANCE-EXPENDITURE-BILLS-06: how a bill's purchase-order reference is shown. A bill stores only the opaque
 * cross-service ref ("procurement_po:<uuid>"); when it was drafted from a GRN it also carries the human PO number
 * procurement sent with it. The number is what a clerk recognises, so it wins; without one the ref is shown in its short
 * readable form (formatEntityRef), and a bill with no PO at all shows "—".
 *
 *   billPoLabel({ poRef: "procurement_po:abc-123", poNumber: "PO-2026-014" }) -> "PO-2026-014"
 *   billPoLabel({ poRef: "procurement_po:5b1c2d3e-0000-4000-8000-000000000000" }) -> "PO 5b1c2d3e"
 *   billPoLabel({ poRef: null })                                              -> "—"
 */
export type BillPoRef = { poRef?: string | null; poNumber?: string | null };

export function billPoLabel(bill: BillPoRef): string {
  const number = bill.poNumber?.trim();
  if (number && number !== "undefined" && number !== "null") return number;
  return formatEntityRef(bill.poRef);
}

/** The purchase-order page for the bill's PO, or null when the ref is absent or names no openable page (never a dead link). */
export function billPoHref(bill: BillPoRef): string | null {
  return opaqueRefHref(bill.poRef);
}
