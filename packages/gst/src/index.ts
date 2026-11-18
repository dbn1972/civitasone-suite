/**
 * @civitasone/gst — pure GST split validation.
 *
 * Copied (not imported) from services/billing-service/src/modules/invoices/domain.ts so that
 * other services (MSME finance-service) can use it without a cross-service dependency.
 * Pure: no DB, no I/O, no env, no service imports. Money is bigint minor units (paise).
 */

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const HSN_SAC_RE = /^[0-9]{4}([0-9]{2}([0-9]{2})?)?$/;

export interface GstDetail {
  supplierGstin: string;
  recipientGstin: string;
  /** Two-digit GST state code of the place of supply. */
  placeOfSupply: string;
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
}

/** The head-rule subset: no recipient GSTIN needed (a B2C bill has none). */
export type GstHeads = Pick<GstDetail, "supplierGstin" | "placeOfSupply" | "cgstMinor" | "sgstMinor" | "igstMinor">;

export interface GstIntraSplit {
  cgstMinor: bigint;
  sgstMinor: bigint;
}

/**
 * Validate the CGST/SGST/IGST split against the tax lines. Intra-state supply (supplier
 * state == place of supply) is CGST + SGST in equal halves with no IGST; inter-state supply
 * is IGST only. The split must equal the invoice tax exactly. Returns an error string, or
 * null when valid.
 */
export function validateGstSplit(g: GstDetail, taxMinor: bigint): string | null {
  if (!GSTIN_RE.test(g.supplierGstin)) return "supplier GSTIN is not a valid 15-character GSTIN";
  if (!GSTIN_RE.test(g.recipientGstin)) return "recipient GSTIN is not a valid 15-character GSTIN";
  if (!/^[0-9]{2}$/.test(g.placeOfSupply)) return "place of supply must be a two-digit GST state code";
  return validateGstHeads(g, taxMinor);
}

/** The intra-/inter-state head rule alone (no recipient GSTIN needed: a B2C bill has none). */
export function validateGstHeads(g: GstHeads, taxMinor: bigint): string | null {
  if (g.cgstMinor < 0n || g.sgstMinor < 0n || g.igstMinor < 0n) return "tax components cannot be negative";
  if (g.cgstMinor + g.sgstMinor + g.igstMinor !== taxMinor) return "CGST + SGST + IGST must equal the invoice tax lines";
  const intraState = g.supplierGstin.slice(0, 2) === g.placeOfSupply;
  if (intraState) {
    if (g.igstMinor !== 0n) return "intra-state supply is CGST + SGST only; IGST must be zero";
    const { cgstMinor: wantC, sgstMinor: wantS } = splitIntraStateTax(taxMinor);
    if (taxMinor % 2n === 1n) {
      // An odd total cannot split equally. Standard split: CGST takes the half rounded down, SGST the half rounded up.
      if (g.cgstMinor !== wantC || g.sgstMinor !== wantS) {
        return `the intra-state tax of ${taxMinor} paise is odd and cannot be split equally: use CGST ${wantC} and SGST ${wantS} paise (CGST rounded down, SGST rounded up)`;
      }
    } else if (g.cgstMinor !== g.sgstMinor) {
      return `CGST and SGST must be equal (${wantC} paise each for tax of ${taxMinor} paise)`;
    }
  } else if (g.cgstMinor !== 0n || g.sgstMinor !== 0n) {
    return "inter-state supply is IGST only; CGST and SGST must be zero";
  }
  return null;
}

/** The intra-state CGST/SGST split of a total tax: equal halves; an odd paisa goes to SGST (CGST rounded down). */
export function splitIntraStateTax(taxMinor: bigint): GstIntraSplit {
  const c = taxMinor / 2n;
  return { cgstMinor: c, sgstMinor: taxMinor - c };
}
