/**
 * Consultant invoice tax engine (pure). Computes GST and Section-194J TDS on a
 * professional-services invoice and the net payable. Money in paise (bigint).
 *
 * 194J: TDS on fees for professional / technical services. Deduction kicks in
 * once the consultant's aggregate for the financial year crosses the threshold
 * (₹30,000 by default); the TDS base is the professional fee only — GST is
 * excluded from the TDS base (CBDT Circular 23/2017). Rates are in basis points
 * (1 bp = 0.01%), so 10% = 1000 bps and 18% GST = 1800 bps.
 *
 * Simplification (documented, not hidden): once the threshold is crossed we
 * deduct TDS on THIS invoice's fee. Retrospective catch-up of TDS on earlier
 * sub-threshold invoices (already paid) is not modelled here — that is a
 * finance-side adjustment, and faking it in this module would be worse than
 * being explicit about the boundary.
 */

/** Round-half-up of value * bps / 10000, on non-negative paise. */
export function applyBps(valueMinor: bigint, bps: number): bigint {
  if (bps <= 0 || valueMinor <= 0n) return 0n;
  return (valueMinor * BigInt(bps) + 5000n) / 10000n;
}

export interface InvoiceTaxInput {
  grossMinor: bigint;        // professional fee before GST / TDS
  gstApplicable: boolean;
  gstRateBps: number;        // e.g. 1800 for 18%
  tdsRateBps: number;        // e.g. 1000 for 194J 10%
  tdsThresholdMinor: bigint; // 194J FY threshold (₹30,000 => 3_000_000n)
  ytdGrossMinor: bigint;     // consultant's YTD approved fees this FY, EXCLUDING this invoice
}

export interface InvoiceTax {
  gstMinor: bigint;
  tdsMinor: bigint;
  netPayableMinor: bigint;   // gross + gst - tds
  tdsApplied: boolean;       // whether the 194J threshold was crossed
}

export function computeInvoiceTax(i: InvoiceTaxInput): InvoiceTax {
  const gstMinor = i.gstApplicable ? applyBps(i.grossMinor, i.gstRateBps) : 0n;
  // Threshold test on the running FY aggregate INCLUDING this invoice.
  const crosses = i.ytdGrossMinor + i.grossMinor >= i.tdsThresholdMinor;
  const tdsMinor = crosses ? applyBps(i.grossMinor, i.tdsRateBps) : 0n;
  return {
    gstMinor,
    tdsMinor,
    netPayableMinor: i.grossMinor + gstMinor - tdsMinor,
    tdsApplied: crosses && tdsMinor > 0n,
  };
}
