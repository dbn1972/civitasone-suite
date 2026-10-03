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

/**
 * GAP-PAYROLL-LOANS-02 (maker-checker on loan disbursal): disbursal releases
 * money, so the officer who CREATED the loan (payroll_loans.created_by) may
 * not also disburse it, and only a loan still in "applied" can be disbursed
 * (previously any status -- including "closed" -- was flipped back to
 * "disbursed", re-emitting payroll.loan.disbursed). Mirrors
 * payroll/consumer.ts's runApprove SELF_APPROVAL_FORBIDDEN rule.
 *
 * Pure (no DB) so routes/commands.ts's synchronous pre-check (immediate
 * 403/409 to the caller) and consumer.ts's authoritative, row-locked re-check
 * evaluate exactly the same rule.
 */
export const DISBURSABLE_LOAN_STATUSES: readonly string[] = ["applied"];

export type DisbursalDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 409; code: "SELF_DISBURSE_FORBIDDEN" | "LOAN_NOT_DISBURSABLE"; message: string };

export function decideDisbursal(
  loan: { status: string; createdBy: string },
  actorId: string,
): DisbursalDecision {
  if (loan.createdBy === actorId) {
    return {
      allowed: false,
      status: 403,
      code: "SELF_DISBURSE_FORBIDDEN",
      message: "a loan must be disbursed by a different officer than the one who created it",
    };
  }
  if (!DISBURSABLE_LOAN_STATUSES.includes(loan.status)) {
    return {
      allowed: false,
      status: 409,
      code: "LOAN_NOT_DISBURSABLE",
      message: `loan in status '${loan.status}' cannot be disbursed`,
    };
  }
  return { allowed: true };
}

/**
 * GAP-PAYROLL-LOANS-05: server-side sanity bounds on the hand-entered loan
 * terms, in integer paise (no floats).
 *
 *  - EMI may not exceed the principal (a single instalment can never recover
 *    more than the loan);
 *  - EMI x tenure must at least repay the principal (otherwise the loan can
 *    never close inside its tenure);
 *  - EMI x tenure may not exceed the SIMPLE-interest total
 *    principal x (1 + rate x tenure/12), plus one paisa per instalment of
 *    rounding. A reducing-balance EMI always collects less than the simple-
 *    interest total, so anything above it is an error, not a policy choice.
 *
 * VERIFY: the ceiling is a mathematical bound, not an organisational limit;
 * a tenant-specific max tenure / max EMI policy would sit on top of this.
 */
export type LoanTermsDecision =
  | { ok: true }
  | { ok: false; code: "EMI_EXCEEDS_PRINCIPAL" | "EMI_TOO_LOW_TO_REPAY" | "EMI_EXCEEDS_INTEREST_BOUND"; message: string };

export function checkLoanTerms(t: { principalMinor: bigint; emiMinor: bigint; tenureMonths: number; interestRatePct: number }): LoanTermsDecision {
  const tenure = BigInt(t.tenureMonths);
  const total = t.emiMinor * tenure;
  if (t.emiMinor > t.principalMinor) {
    return { ok: false, code: "EMI_EXCEEDS_PRINCIPAL", message: "monthly EMI cannot be more than the loan principal" };
  }
  if (total < t.principalMinor) {
    return { ok: false, code: "EMI_TOO_LOW_TO_REPAY", message: "EMI x tenure is less than the principal: the loan could never be repaid within its tenure" };
  }
  const rateBps = BigInt(Math.round(t.interestRatePct * 100));
  // principal x (12*10000 + rateBps x tenure) / (12*10000), rounded up, + 1 paisa per instalment.
  const denom = 120_000n;
  const bound = (t.principalMinor * (denom + rateBps * tenure) + denom - 1n) / denom + tenure;
  if (total > bound) {
    return { ok: false, code: "EMI_EXCEEDS_INTEREST_BOUND", message: "EMI x tenure is more than the principal plus simple interest for the tenure: check the EMI" };
  }
  return { ok: true };
}

/** LN-<year>-<6-digit sequence>, e.g. LN-2026-000042. */
export function formatLoanNo(year: number, seq: number): string {
  return `LN-${year}-${String(seq).padStart(6, "0")}`;
}
