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
};

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
  };
}
