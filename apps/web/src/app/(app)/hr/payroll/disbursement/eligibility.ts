import type { RunOption } from "./BankFileWizard";

// netAmount/grossAmount are RUPEES on the runs-list API (payroll-service
// queries.listRuns divides the paise aggregate by 100).
export type RunRow = {
  id: string;
  runDate: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  status: "draft" | "processing" | "completed" | "paid" | "failed" | string;
} & Record<string, unknown>;

/**
 * GAP-PAYROLL-DISBURSEMENT-02: the statuses a bank file may be generated for.
 * API "completed" is the DB's "approved" (post maker-checker) and "paid" is
 * "disbursed" (an audited re-issue) -- exactly payroll-service's own
 * approved|disbursed gate in bank-transfer/routes.ts. Draft, processing and
 * failed runs are never eligible.
 */
export const BANK_FILE_ELIGIBLE_STATUSES = ["completed", "paid"] as const;

export function eligibleBankFileRuns(runs: RunRow[]): RunOption[] {
  return runs
    .filter((r): r is RunRow & { status: RunOption["status"] } =>
      (BANK_FILE_ELIGIBLE_STATUSES as readonly string[]).includes(r.status))
    .map((r) => ({
      id: r.id,
      payPeriod: r.payPeriod,
      netAmountRupees: r.netAmount,
      employeeCount: r.employeeCount,
      status: r.status,
    }));
}

