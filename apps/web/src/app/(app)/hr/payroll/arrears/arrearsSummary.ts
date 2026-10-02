/**
 * GAP-PAYROLL-ARREARS-02: the "Total Arrears Amount" stat used to net EVERY
 * row (rejected, already-paid and negative recovery rows included) into a
 * figure labelled as owed. payroll_arrears.status is constrained to
 * pending | approved | paid | rejected (payroll-service migration 0005), so the
 * outstanding amount is the sum over the not-yet-paid, not-rejected rows.
 * Recoveries (negative difference_minor) are kept visible, not silently netted
 * into a gross figure: they are returned separately and the headline is labelled
 * "net of recoveries".
 *
 * Money is paise: summed as bigint, never as a JS float.
 */
export const ARREARS_OUTSTANDING_STATUSES: readonly string[] = ["pending", "approved"];

export type ArrearsSummary = {
  /** pending + approved rows, net of recoveries (paise). */
  outstandingNetMinor: bigint;
  /** pending + approved rows with a negative difference (paise, <= 0). */
  recoveriesMinor: bigint;
  /** paid rows (paise). */
  paidMinor: bigint;
};

function toMinor(v: unknown): bigint {
  try {
    return BigInt(String(v ?? 0));
  } catch {
    return 0n;
  }
}

export function summarizeArrears(rows: ReadonlyArray<{ status: string; difference_minor: number | string | null | undefined }>): ArrearsSummary {
  let outstanding = 0n;
  let recoveries = 0n;
  let paid = 0n;
  for (const r of rows) {
    const d = toMinor(r.difference_minor);
    if (ARREARS_OUTSTANDING_STATUSES.includes(r.status)) {
      outstanding += d;
      if (d < 0n) recoveries += d;
    } else if (r.status === "paid") {
      paid += d;
    }
  }
  return { outstandingNetMinor: outstanding, recoveriesMinor: recoveries, paidMinor: paid };
}
