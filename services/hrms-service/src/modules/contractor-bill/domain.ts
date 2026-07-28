/**
 * Contractor bill tax engine (pure). Computes GST and Section-194C TDS on a
 * contract-labour bill and the net payable to the agency. Money in paise (bigint).
 *
 * §194C: TDS on payments to a contractor for carrying out work (incl. supply of
 * labour). Rate is 1% where the contractor is an individual / HUF, else 2%. The
 * deduction is triggered when EITHER a single bill is ≥ ₹30,000 OR the aggregate
 * of bills in the financial year (incl. this one) is ≥ ₹1,00,000. The TDS base is
 * the labour charge only — GST is excluded (CBDT Circular 23/2017). Rates are in
 * basis points (100 bps = 1%). No PAN → 20% (206AA) is a finance-side concern and
 * is not modelled here (documented, not hidden).
 */

/** Round-half-up of value * bps / 10000, on non-negative paise. */
export function applyBps(valueMinor: bigint, bps: number): bigint {
  if (bps <= 0 || valueMinor <= 0n) return 0n;
  return (valueMinor * BigInt(bps) + 5000n) / 10000n;
}

export type ContractorKind = "individual_huf" | "other";

/** §194C rate in basis points: 1% (100) for individual/HUF, else 2% (200). */
export function tds194cRateBps(kind: ContractorKind): number {
  return kind === "individual_huf" ? 100 : 200;
}

export interface ContractTaxInput {
  grossMinor: bigint;           // labour charges before GST / TDS
  gstApplicable: boolean;
  gstRateBps: number;
  contractorKind: ContractorKind;
  singleThresholdMinor: bigint; // ₹30,000  => 3_000_000n
  annualThresholdMinor: bigint; // ₹1,00,000 => 10_000_000n
  ytdGrossMinor: bigint;        // agency's YTD approved bills this FY, EXCLUDING this one
}

export interface ContractTax {
  gstMinor: bigint;
  tdsRateBps: number;
  tdsMinor: bigint;
  netPayableMinor: bigint;      // gross + gst - tds
  tdsApplied: boolean;
}

export function computeContractTax(i: ContractTaxInput): ContractTax {
  const gstMinor = i.gstApplicable ? applyBps(i.grossMinor, i.gstRateBps) : 0n;
  // §194C trigger: single bill ≥ 30k OR FY aggregate (incl. this) ≥ 1L.
  const triggered =
    i.grossMinor >= i.singleThresholdMinor ||
    i.ytdGrossMinor + i.grossMinor >= i.annualThresholdMinor;
  const tdsRateBps = tds194cRateBps(i.contractorKind);
  const tdsMinor = triggered ? applyBps(i.grossMinor, tdsRateBps) : 0n;
  return {
    gstMinor,
    tdsRateBps,
    tdsMinor,
    netPayableMinor: i.grossMinor + gstMinor - tdsMinor,
    tdsApplied: triggered && tdsMinor > 0n,
  };
}
