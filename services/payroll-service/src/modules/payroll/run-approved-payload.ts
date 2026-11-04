/**
 * payroll.run.approved payload (producer side of the finance GL accrual).
 * Consumer: finance-service modules/integrations/payroll-accrual.ts; the pair
 * is pinned by tests/contract/payroll-run-approved.contract.test.ts.
 *
 * UAT b18 (ERP-head decision 2026-11-05, PR #2458): the employer EDLI
 * (EPFO A/c 21), EPF admin charges (A/c 2) and the Government 8.5% UPS pool
 * share are payable but were not accrued. They travel as three ADDITIVE
 * fields -- never folded into totalEmployerContribMinor -- so finance posts
 * each as its own line and an older finance build simply ignores them.
 * Paise as bigint digit strings.
 */
export interface RunApprovedInput {
  runId: string;
  month: string;
  totalGrossMinor: bigint;
  totalNetMinor: bigint;
  /** Employer PF (EPS + EPF), ESI and NPS / UPS individual shares. */
  totalEmployerContribMinor: bigint;
  edliMinor: bigint;
  epfAdminMinor: bigint;
  upsPoolMinor: bigint;
  legalEntityId?: string | null;
}

export type RunApprovedPayload = {
  runId: string;
  month: string;
  totalGrossMinor: string;
  totalNetMinor: string;
  totalEmployerContribMinor: string;
  totalEdliMinor: string;
  totalEpfAdminMinor: string;
  totalUpsPoolMinor: string;
  legalEntityId?: string;
  /**
   * UAT T-PERIOD D-04 (ERP-head decision 2026-11-05): this build also carries
   * the accrual amounts on payroll.run.disbursed (runDisbursedPayload), so
   * finance may post a cash-basis tenant accrual on the payment date instead.
   * Additive; an older finance build ignores it.
   */
  accrualCarriedOnDisbursal: true;
};

/**
 * payroll.run.disbursed payload. runId / month / totalNetMinor as before, plus
 * (UAT T-PERIOD D-04, additive) the IST payment date and the same accrual
 * amounts as payroll.run.approved: finance dates the settlement on the payment
 * date and, for a cash-basis tenant, posts the deferred accrual then. Consumer:
 * finance-service gl/consumer.ts; pinned by
 * tests/contract/payroll-run-disbursed.contract.test.ts.
 */
export type RunDisbursedPayload = Omit<RunApprovedPayload, "accrualCarriedOnDisbursal"> & { paymentDate: string };

/** The IST (UTC+05:30) calendar date of an instant, YYYY-MM-DD. Pure. */
export function istDateOf(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function runDisbursedPayload(i: RunApprovedInput & { disbursedAt: Date }): RunDisbursedPayload {
  const { accrualCarriedOnDisbursal: _carried, ...amounts } = runApprovedPayload(i);
  return { ...amounts, paymentDate: istDateOf(i.disbursedAt) };
}

export function runApprovedPayload(i: RunApprovedInput): RunApprovedPayload {
  return {
    runId: i.runId,
    month: i.month,
    totalGrossMinor: i.totalGrossMinor.toString(),
    totalNetMinor: i.totalNetMinor.toString(),
    totalEmployerContribMinor: i.totalEmployerContribMinor.toString(),
    totalEdliMinor: i.edliMinor.toString(),
    totalEpfAdminMinor: i.epfAdminMinor.toString(),
    totalUpsPoolMinor: i.upsPoolMinor.toString(),
    ...(i.legalEntityId ? { legalEntityId: i.legalEntityId } : {}),
    accrualCarriedOnDisbursal: true,
  };
}
