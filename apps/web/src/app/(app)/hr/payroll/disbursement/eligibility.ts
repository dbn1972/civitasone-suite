import type { RunOption } from "./BankFileWizard";
import { rupeesToMinorString } from "@/lib/money";

// netAmount/grossAmount are RUPEES on the runs-list API (payroll-service
// queries.listRuns divides the paise aggregate by 100). grossMinor/netMinor/
// deductionsMinor (GAP-PAYROLL-DISBURSEMENT-08) are the same totals in exact
// integer paise as strings -- money screens use those.
export type RunRow = {
  id: string;
  runDate: string;
  payPeriod: string;
  employeeCount: number;
  grossAmount: number;
  netAmount: number;
  netMinor?: string;
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

/** Exact paise from the API's string; falls back to the rupee number only for an older payroll-service. */
export function netMinorOf(r: Pick<RunRow, "netMinor" | "netAmount">): string {
  if (typeof r.netMinor === "string" && /^-?\d+$/.test(r.netMinor)) return r.netMinor;
  return rupeesToMinorString(r.netAmount.toFixed(2), { allowZero: true }) ?? "0";
}

export function eligibleBankFileRuns(runs: RunRow[]): RunOption[] {
  return runs
    .filter((r): r is RunRow & { status: RunOption["status"] } =>
      (BANK_FILE_ELIGIBLE_STATUSES as readonly string[]).includes(r.status))
    .map((r) => ({
      id: r.id,
      payPeriod: r.payPeriod,
      netAmountMinor: netMinorOf(r),
      employeeCount: r.employeeCount,
      status: r.status,
    }));
}

