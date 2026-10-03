/**
 * GST console totals in exact paise (bigint) — never Number() on money.
 *
 * GAP-FINANCE-GST-04: sumMinor replaces the Number() reduces.
 * GAP-FINANCE-GST-02: net payable is head-wise. Under the GST credit
 * utilisation rules a surplus in one head (e.g. CGST) cannot be netted against
 * a liability in another (e.g. SGST), so the headline is the sum of the
 * POSITIVE head balances and the surplus is shown separately as credit carried
 * forward. Statutory IGST -> CGST/SGST utilisation ordering is NOT modelled
 * here (tax-owner decision; see the ml-finance-05 PR VERIFY list).
 * GAP-FINANCE-GST-03: the ITC card is the reconciled itc_available figure.
 */

const INTEGER = /^[+-]?\d+$/;

/** Parse one minor-unit value to bigint, or null when it is not a whole number. */
export function parseMinorStrict(v: string | number | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) ? BigInt(v) : null;
  const t = v.trim();
  return INTEGER.test(t) ? BigInt(t) : null;
}

/**
 * Exact sum of minor-unit values. Returns null (rendered as "—") when ANY
 * value is not an integer string/number, so a malformed value can never
 * silently count as 0. An empty list sums to 0n. null/undefined entries are
 * treated as absent (0), matching the old `?? 0`.
 */
export function sumMinor(values: ReadonlyArray<string | number | null | undefined>): bigint | null {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const p = parseMinorStrict(v);
    if (p === null) return null;
    total += p;
  }
  return total;
}

export type ItcHeadRow = {
  itc_available?: string | number | null;
  output_liability?: string | number | null;
  net_payable?: string | number | null;
};

export type GstHeadTotals = {
  /** Sum of itc_available across heads (the reconciled input tax credit). */
  itcAvailable: bigint;
  /** Sum of the positive head-wise net payables. */
  payable: bigint;
  /** Sum of the surpluses (negative head-wise net payables), as a positive amount. */
  creditCarriedForward: bigint;
};

export function gstHeadTotals(rows: readonly ItcHeadRow[]): GstHeadTotals | null {
  const itcAvailable = sumMinor(rows.map((r) => r.itc_available));
  if (itcAvailable === null) return null;
  let payable = 0n;
  let carry = 0n;
  for (const r of rows) {
    const net = parseMinorStrict(r.net_payable ?? 0);
    if (net === null) return null;
    if (net > 0n) payable += net;
    else carry += -net;
  }
  return { itcAvailable, payable, creditCarriedForward: carry };
}

/** GAP-FINANCE-GST-06: month 01-12 only ("2026-13" is not a period). */
export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type SetOffEstimate = {
  /** Estimated cash payable after the statutory set-off, in paise. */
  cashPayable: bigint;
};

/**
 * Indicative estimate of cash payable after the statutory credit set-off,
 * from head-wise net balances (output tax - input credit, per head):
 *  1. IGST credit is applied against IGST, then CGST, then SGST.
 *  2. CGST credit is applied against CGST (already netted in the head balance), then IGST.
 *  3. SGST credit is applied against SGST (already netted), then IGST.
 *  CGST and SGST credit never cross. CESS (and any unknown head) is own-head only.
 * Step 1 runs before steps 2-3; the CGST-then-SGST order against IGST is not
 * statutory-critical here because both draw from the same remaining IGST. The
 * figure is an estimate only: cash payable is finalised in GSTR-3B.
 * Returns null when any balance is malformed.
 */
export function estimateCashPayable(rows: readonly { gst_type?: string; net_payable?: string | number | null }[]): SetOffEstimate | null {
  const liab: Record<string, bigint> = { IGST: 0n, CGST: 0n, SGST: 0n };
  const credit: Record<string, bigint> = { IGST: 0n, CGST: 0n, SGST: 0n };
  let other = 0n;
  for (const r of rows) {
    const net = parseMinorStrict(r.net_payable ?? 0);
    if (net === null) return null;
    const head = String(r.gst_type ?? "").toUpperCase();
    if (head in liab) {
      if (net > 0n) liab[head]! += net;
      else credit[head]! += -net;
    } else if (net > 0n) other += net;
  }
  const applyCredit = (c: bigint, head: string): bigint => {
    const t = c < liab[head]! ? c : liab[head]!;
    liab[head]! -= t;
    return c - t;
  };
  let ci = credit["IGST"]!;
  for (const h of ["IGST", "CGST", "SGST"]) ci = applyCredit(ci, h);
  let cc = credit["CGST"]!;
  cc = applyCredit(cc, "CGST");
  applyCredit(cc, "IGST");
  let cs = credit["SGST"]!;
  cs = applyCredit(cs, "SGST");
  applyCredit(cs, "IGST");
  return { cashPayable: liab["IGST"]! + liab["CGST"]! + liab["SGST"]! + other };
}
