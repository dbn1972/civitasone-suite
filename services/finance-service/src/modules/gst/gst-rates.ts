/**
 * GST rate validation (DOM-013).
 *
 * Pre-fix, `finance.gst.entry_record`'s `ratePct` was typed but never
 * checked before being written to gl.finance_gst_ledger -- any number
 * (including a typo, a negative value, or NaN) would be silently stored as
 * an authoritative GST rate.
 *
 * Standard GST slabs (stable since the 2017 rollout): 0%, 0.25% (rough
 * precious/semi-precious stones), 3% (gold/silver/precious metals), and the
 * four general slabs 5/12/18/28%. This is NOT a comprehensive HSN/SAC-level
 * table -- the GST Council periodically reclassifies specific goods/
 * services between these slabs -- but the slab *structure* itself has held
 * for years.
 *
 * IMPORTANT — CGST/SGST split: for an intra-state supply the total slab
 * rate is split evenly between CGST and SGST (e.g. an 18% slab item is
 * recorded as a 9% CGST line + a 9% SGST line, not two 18% lines) —
 * `gl.finance_gst_ledger` stores one row per component, so a CGST/SGST row
 * legitimately carries HALF a standard slab. IGST (inter-state) carries the
 * full slab rate directly. This first fix caught exactly this: an earlier
 * draft validated every gst_type against the full-slab list and would have
 * rejected a completely valid CGST/SGST row (e.g. 9%) written by an
 * existing, tested code path.
 *
 * CESS is intentionally NOT validated against a fixed rate list here: GST
 * compensation cess is item-specific (ad valorem percentages, flat per-unit
 * amounts, and formula-based rates depending on the good), not a small
 * closed set of slabs, and asserting a specific CESS rate table without
 * verified per-HSN reference data would be guessing at real tax facts.
 * CESS rows only get the same sanity bound as everything else.
 */
const FULL_SLABS: readonly number[] = [0, 0.25, 3, 5, 12, 18, 28];
const HALF_SLABS: readonly number[] = FULL_SLABS.map((r) => r / 2); // CGST/SGST component rate

export const VALID_GST_RATES: readonly number[] = FULL_SLABS;

/**
 * `gstType` is one of "CGST" | "SGST" | "IGST" | "CESS" on
 * gl.finance_gst_ledger. CGST/SGST rows are checked against the halved
 * slabs, IGST against the full slabs. CESS only gets the 0-100 sanity
 * bound below (see file header for why).
 */
export function isValidGstRate(ratePct: number, gstType?: string): boolean {
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) return false;
  if (gstType === "CGST" || gstType === "SGST") return HALF_SLABS.includes(ratePct);
  if (gstType === "IGST") return FULL_SLABS.includes(ratePct);
  // CESS, or gstType not supplied: only the sanity bound applies.
  return true;
}
