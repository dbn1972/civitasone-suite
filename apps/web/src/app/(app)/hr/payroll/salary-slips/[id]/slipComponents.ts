/**
 * GAP-PAYROLL-SALARY-SLIPS-DETAIL-03: partition a slip's components so none is
 * silently dropped, and check the printed lines against the slip's own totals.
 *
 * Earnings/deductions are the two types that feed Gross / Total Deductions.
 * Any other type (employer contribution, reimbursement, perquisite...) is
 * returned in `other`, shown separately and EXCLUDED from net -- not hidden.
 * `earningsMatchGross` / `deductionsMatchTotal` let the page flag a slip whose
 * listed lines do not add up, instead of printing it as if reconciled.
 * All sums are integer paise (bigint).
 */
export type SlipComponentLike = { code: string; name: string; type: string; amountMinor: number | string };

export type SlipBreakdown<C extends SlipComponentLike> = {
  earnings: C[];
  deductions: C[];
  other: C[];
  earningsSumMinor: bigint;
  deductionsSumMinor: bigint;
  earningsMatchGross: boolean;
  deductionsMatchTotal: boolean;
};

function minor(v: number | string): bigint {
  try {
    return BigInt(typeof v === "number" ? Math.round(v) : v);
  } catch {
    return 0n;
  }
}

export function breakdownSlip<C extends SlipComponentLike>(
  components: readonly C[],
  grossMinor: number | string,
  totalDeductionsMinor: number | string,
): SlipBreakdown<C> {
  const earnings = components.filter((c) => c.type === "earning");
  const deductions = components.filter((c) => c.type === "deduction");
  const other = components.filter((c) => c.type !== "earning" && c.type !== "deduction");
  const earningsSumMinor = earnings.reduce((s, c) => s + minor(c.amountMinor), 0n);
  const deductionsSumMinor = deductions.reduce((s, c) => s + minor(c.amountMinor), 0n);
  return {
    earnings,
    deductions,
    other,
    earningsSumMinor,
    deductionsSumMinor,
    earningsMatchGross: earningsSumMinor === minor(grossMinor),
    deductionsMatchTotal: deductionsSumMinor === minor(totalDeductionsMinor),
  };
}
