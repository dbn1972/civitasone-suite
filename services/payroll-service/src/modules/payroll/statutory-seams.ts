/**
 * S8 statutory seams (Section 8 / autonomous-body lane D). Pure helpers for
 * three OPT-IN seams of computeSlip (domain.ts). Every seam is off unless the
 * run feeds it, so a government tenant's slips are unchanged (pinned by
 * tests/s8-computeslip-pin.test.ts).
 *
 * SEAM 1 -- EPF wage basis per employee ("PF on actual basic")
 *   Legal name used in the UI: "EPF contribution on wages above the statutory
 *   ceiling (voluntary, employer and employee jointly)" -- EPF Scheme 1952
 *   para 26(6) as understood by the author. VERIFY with counsel/CA before
 *   showing a legal citation in the UI.
 *   NOT the same as employee.epfVoluntaryJointOption: that is the EPS joint
 *   option (EPS 1995 para 11(3)) to pay PENSION contributions on higher wages
 *   and only feeds epsEligibility(). This seam changes only the EPF wage;
 *   EPS wage stays at the ceiling, EPS rules (epsEligible etc.) are untouched.
 *
 * SEAM 2 -- Labour Welfare Fund. payroll.payroll_lwf stores employee/employer
 *   amount and frequency per state. Which months a state collects in is state
 *   law; DEFAULT_LWF_DUE_MONTHS below is a VERIFY placeholder, not law.
 *
 * SEAM 3 -- ESI contribution-period continuity. ESI contribution periods are
 *   Apr-Sep and Oct-Mar (VERIFY); the reading implemented is "an employee who
 *   was ESI-covered earlier in the period stays covered to the period end even
 *   if the wage later passes the ceiling". The repo's own docs/config do not
 *   confirm the rule, so the seam ships DISABLED (flag default false) and is
 *   listed as VERIFY in the PR.
 */

export type PfWageBasis = "ceiling" | "actual";
export type LwfFrequency = "monthly" | "quarterly" | "half_yearly" | "yearly";

export interface PfWageBasisRow { effectiveFrom: string; basis: PfWageBasis }

/** The basis in force for `month` (YYYY-MM): latest row with effective_from <= first day of the month. Default "ceiling". */
export function pfWageBasisFor(rows: readonly PfWageBasisRow[] | undefined, month: string): PfWageBasis {
  if (!rows || rows.length === 0) return "ceiling";
  const monthEnd = `${month}-31`; // string compare on ISO dates; a mid-month effective date applies to the whole month
  let best: PfWageBasisRow | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= monthEnd && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best ? best.basis : "ceiling";
}

/**
 * VERIFY (placeholder, not law): calendar months (1-12) in which each frequency
 * is collected, deducted in the month that closes the period. States differ;
 * a state-specific due-month list needs to become data before go-live.
 */
export const DEFAULT_LWF_DUE_MONTHS: Readonly<Record<LwfFrequency, readonly number[]>> = {
  monthly: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  quarterly: [3, 6, 9, 12],
  half_yearly: [6, 12],
  yearly: [12],
};

export interface LwfRule { employeeMinor: bigint; employerMinor: bigint; frequency: LwfFrequency }

/** The LWF amounts due in `month` (YYYY-MM) under `rule`, or null when none is due (no rule, zero amounts, off-cycle month). */
export function lwfDueForMonth(rule: LwfRule | undefined, month: string): { employeeMinor: bigint; employerMinor: bigint } | null {
  if (!rule) return null;
  const m = Number(month.slice(5, 7));
  if (!DEFAULT_LWF_DUE_MONTHS[rule.frequency]?.includes(m)) return null;
  if (rule.employeeMinor <= 0n && rule.employerMinor <= 0n) return null;
  return { employeeMinor: rule.employeeMinor, employerMinor: rule.employerMinor };
}

/** First month (YYYY-MM) of the ESI contribution period containing `month`: Apr-Sep or Oct-Mar. */
export function esiContributionPeriodStart(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  if (m >= 4 && m <= 9) return `${y}-04`;
  if (m >= 10) return `${y}-10`;
  return `${y - 1}-10`; // Jan-Mar belongs to the period that began the previous October
}

/** true when the employee was ESI-covered in any earlier month of the same contribution period. */
export function esiContinuesInPeriod(month: string, coveredMonths: readonly string[] | undefined): boolean {
  if (!coveredMonths || coveredMonths.length === 0) return false;
  const start = esiContributionPeriodStart(month);
  return coveredMonths.some((c) => c >= start && c < month);
}
