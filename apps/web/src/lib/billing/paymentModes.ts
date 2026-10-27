/**
 * Owner decision #26 (GAP-TENANT-ADMIN-PLANS-04): government editions pay by
 * PO/GeM, treasury e-challan or online; every other edition pays online. No card
 * gateway is named: the mode list drives wording only.
 */
export type PaymentMode = "po_gem" | "treasury_challan" | "online";

const GOVERNMENT_EDITIONS = new Set(["govt", "govt_dept"]);

export function paymentModesForEdition(edition: string | null | undefined): PaymentMode[] {
  return edition && GOVERNMENT_EDITIONS.has(edition) ? ["po_gem", "treasury_challan", "online"] : ["online"];
}
