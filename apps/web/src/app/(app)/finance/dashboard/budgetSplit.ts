/**
 * GAP-FINANCE-DASHBOARD-04: how the dashboard's budget donut is split.
 *
 * "Remaining" used to be back-computed from the utilisation percentage in
 * float rupees and was forced to 0 above 100%, so an overspent budget drew a
 * full ring labelled "Remaining ₹0.00". All arithmetic here is bigint paise;
 * numbers are produced only by the caller, for chart geometry.
 *
 * The comparison is expenditure against the BUDGET ESTIMATE (BE) total only
 * (finance-service sums `be_minor`; no RE / re-appropriation), so the UI calls
 * it "budget estimate", not "sanctioned budget".
 */
export type BudgetSplit =
  | { kind: "no-budget"; expenditureMinor: bigint }
  /** remainingMinor is null when the exact estimate is unknown (older API): no amount is shown. */
  | { kind: "within"; expenditureMinor: bigint; remainingMinor: bigint | null }
  /** Older API only: over the estimate by an unknowable amount (the percentage is rounded), so no amount. */
  | { kind: "over-budget"; expenditureMinor: bigint }
  | { kind: "overspent"; expenditureMinor: bigint; sanctionedMinor: bigint; overspentMinor: bigint };

function toBigInt(v: number | string | bigint | null | undefined): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.round(v)) : null;
  return /^-?\d+$/.test(v.trim()) ? BigInt(v.trim()) : null;
}

export function computeBudgetSplit(args: {
  utilisationPct: number | null;
  /** Total expenditure, minor units (paise). */
  expenditure: number | string | bigint;
  /** Total sanctioned budget, minor units, when the API supplies it. */
  sanctionedMinor?: string | null;
}): BudgetSplit {
  const exp = toBigInt(args.expenditure) ?? 0n;
  const sanctioned = toBigInt(args.sanctionedMinor);

  if (sanctioned !== null && sanctioned > 0n) {
    return exp > sanctioned
      ? { kind: "overspent", expenditureMinor: exp, sanctionedMinor: sanctioned, overspentMinor: exp - sanctioned }
      : { kind: "within", expenditureMinor: exp, remainingMinor: sanctioned - exp };
  }
  // The API said there is a sanctioned total of zero, or utilisation is
  // unknown: there is no budget to measure against.
  if (sanctioned === 0n || args.utilisationPct === null || !Number.isFinite(args.utilisationPct)) {
    return { kind: "no-budget", expenditureMinor: exp };
  }

  // Older API without sanctionedMinor: the percentage is integer-rounded, so
  // any rupee remaining/overspent derived from it would be a made-up exact
  // figure (e.g. a true 100.4% reads as 100%). Say only which side of the
  // estimate we are on, with no amount.
  return args.utilisationPct > 100
    ? { kind: "over-budget", expenditureMinor: exp }
    : { kind: "within", expenditureMinor: exp, remainingMinor: null };
}
