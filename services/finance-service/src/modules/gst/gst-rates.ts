/**
 * GST rate validation (DOM-013), now driven by the EFFECTIVE-DATED rate master (MSME M3a).
 *
 * Pre-fix, `finance.gst.entry_record`'s `ratePct` was typed but never checked before being written to gl.finance_gst_ledger.
 * DOM-013 then checked it against a hard-coded 0/0.25/3/5/12/18/28 list. That list is wrong from 2025-09-22 (the 56th GST Council
 * rationalisation closed 12% and 28% and added 40%), and a hard-coded list cannot be effective-dated. The slabs now come from
 * gl.finance_gst_rate_master (migration 0175, global, effective_from/effective_to) read AS OF the invoice date -- see
 * rate-master.ts. The master rows are placeholders flagged verify_by_ca; nothing here is law.
 *
 * IMPORTANT -- CGST/SGST split: for an intra-state supply the total slab rate is split evenly between CGST and SGST (an 18% slab item
 * is a 9% CGST line + a 9% SGST line), so a CGST/SGST row legitimately carries HALF a slab. IGST carries the full slab.
 *
 * CESS is intentionally NOT validated against the slab list: compensation cess is item-specific (ad valorem, specific, or
 * formula-based), not a small closed set. CESS rows only get the 0-100 sanity bound.
 */
export const LEGACY_SLABS: readonly number[] = [0, 0.25, 3, 5, 12, 18, 28];
/** @deprecated the pre-2025-09-22 slab list, kept for pure unit tests of the CGST/SGST split; production reads the rate master. */
export const VALID_GST_RATES: readonly number[] = LEGACY_SLABS;

/**
 * @param slabs the full-slab rates effective on the invoice date (from the rate master). Defaults to the legacy list ONLY for
 *              pure callers that have no database (tests of the split rule); every production caller passes the master's slabs.
 */
export function isValidGstRate(ratePct: number, gstType?: string, slabs: readonly number[] = LEGACY_SLABS): boolean {
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) return false;
  if (gstType === "CGST" || gstType === "SGST") return slabs.some((s) => s / 2 === ratePct);
  if (gstType === "IGST") return slabs.includes(ratePct);
  // CESS, or gstType not supplied: only the sanity bound applies.
  return true;
}
