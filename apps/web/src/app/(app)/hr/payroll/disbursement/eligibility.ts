import type { RunOption } from "./BankFileWizard";
import { runMinor } from "@/lib/payroll/runMoney";

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

/**
 * Exact paise from the API's string; falls back to the rupee number only for an
 * older payroll-service. Delegates to the shared run-money adapter
 * (lib/payroll/runMoney.ts, GAP-PAYROLL-RUNS-01) so every run screen resolves a
 * run's money the same way.
 */
export function netMinorOf(r: Pick<RunRow, "netMinor" | "netAmount">): string {
  return runMinor({ netMinor: r.netMinor, netAmount: r.netAmount }, "net")?.toString() ?? "0";
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

