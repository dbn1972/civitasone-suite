/**
 * GAP-FINANCE-VENDORS-03/04/05: pure rules for the vendors register cards and
 * the GSTIN cell, tolerant of a row with a null status / category / gstin.
 */
export interface VendorStatInput {
  status?: string | null;
  category?: string | null;
  gstin?: string | null;
}

export function vendorStats(vendors: readonly VendorStatInput[]) {
  let active = 0;
  const categories = new Set<string>();
  for (const v of vendors) {
    if (String(v.status ?? "").trim().toLowerCase() === "active") active += 1;
    // "Supplier" / "supplier " are one category; a missing category is none.
    const c = String(v.category ?? "").trim().toLowerCase();
    if (c !== "") categories.add(c);
  }
  return { total: vendors.length, active, categories: categories.size };
}

/** GSTIN cell text: a vendor with no GSTIN is unregistered, which drives TDS / ITC handling. */
export const UNREGISTERED_GSTIN_LABEL = "Unregistered";

export function gstinCell(gstin: string | null | undefined): string {
  const g = String(gstin ?? "").trim();
  return g === "" ? UNREGISTERED_GSTIN_LABEL : g;
}
