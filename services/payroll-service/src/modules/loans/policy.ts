/**
 * BUG-1 (payroll loans EMI cap) -- see this PR's description for full context.
 *
 * PLACEHOLDER POLICY VALUE: nothing in this codebase documents a rule
 * capping an employee's COMBINED loan EMI as a percentage of gross pay.
 * payroll/domain.ts's headroom/recoveryCap is a *different*, later-stage
 * safety net -- it caps how much of a GIVEN payroll run's deductions can
 * actually be recovered without breaching a protected net-pay floor,
 * computed from that run's real numbers. It says nothing about whether a
 * NEW loan should be allowed to exist at application time, so it cannot be
 * reused directly here -- but it still applies independently, after this
 * check, at actual disbursement/recovery time, as a backstop.
 *
 * 50% mirrors the general shape of Indian government FR/CDA-style
 * pay-and-recovery ceilings (a common real-world anchor for this kind of
 * rule), but is NOT sourced from any confirmed CivitasOne policy document.
 * Treat this as a conservative placeholder pending a real decision -- do not
 * present it to users or auditors as an established rule.
 */
export const MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS = 50n;

export type EmiCapDecision = {
  allowed: boolean;
  existingEmiMinor: bigint;
  combinedEmiMinor: bigint;
  grossMinor: bigint | null;
  capMinor: bigint | null;
};

/**
 * Pure decision function -- no DB access, so the exact same arithmetic runs
 * from both commands.ts's synchronous pre-check and consumer.ts's
 * authoritative, advisory-lock-guarded re-check without duplicating it.
 *
 * `grossMinor` is the employee's most recently computed payroll gross
 * (payroll_slips.gross_minor). When null (no payroll history yet -- e.g. a
 * brand-new employee's very first loan application) this ALLOWS the loan:
 * there is no gross figure to compute a percentage against, and failing
 * closed would block every new employee's first-ever loan application --
 * a real product decision this fix is not positioned to make unilaterally.
 * payroll/domain.ts's recoveryCap still protects actual net pay at
 * disbursement/recovery time regardless of this decision.
 */
export function decideCombinedEmiCap(
  existingEmiMinor: bigint,
  newEmiMinor: bigint,
  grossMinor: bigint | null,
): EmiCapDecision {
  const combinedEmiMinor = existingEmiMinor + newEmiMinor;
  if (grossMinor == null || grossMinor <= 0n) {
    return { allowed: true, existingEmiMinor, combinedEmiMinor, grossMinor: grossMinor ?? null, capMinor: null };
  }
  const capMinor = (grossMinor * MAX_COMBINED_LOAN_EMI_PCT_OF_GROSS) / 100n;
  return { allowed: combinedEmiMinor <= capMinor, existingEmiMinor, combinedEmiMinor, grossMinor, capMinor };
}

/**
 * Sums EMI for every loan not yet fully repaid. "closed" is the only
 * terminal status in this codebase (set by payroll/consumer.ts's
 * processPayrollRun once outstandingMinor reaches zero) -- both "applied"
 * (not yet disbursed) and "disbursed" (actively being recovered) count
 * toward the cap. Excluding "applied" loans would let an employee stack
 * several simultaneous applications before any one of them clears.
 */
export function sumActiveEmiMinor(
  loans: ReadonlyArray<{ id: string; status: string; emiMinor: bigint }>,
  excludeLoanId?: string,
): bigint {
  return loans.reduce(
    (sum, l) => (l.status !== "closed" && l.id !== excludeLoanId ? sum + l.emiMinor : sum),
    0n,
  );
}
