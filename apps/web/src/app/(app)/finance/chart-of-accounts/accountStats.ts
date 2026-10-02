import type { AccountSummary } from "@civitasone/types";

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-02: per-type counts for the Chart of Accounts
 * stat cards. "Income / Expense" used to be `total - (asset + liability)`,
 * which silently counted every equity head as income/expense.
 */
export function countAccountsByType(rows: Pick<AccountSummary, "type" | "status">[]): {
  total: number;
  assetLiability: number;
  equity: number;
  incomeExpense: number;
  active: number;
} {
  let assetLiability = 0;
  let equity = 0;
  let incomeExpense = 0;
  let active = 0;
  for (const a of rows) {
    if (a.type === "asset" || a.type === "liability") assetLiability += 1;
    else if (a.type === "equity") equity += 1;
    else if (a.type === "income" || a.type === "expense") incomeExpense += 1;
    if (a.status === "active") active += 1;
  }
  return { total: rows.length, assetLiability, equity, incomeExpense, active };
}

/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-03: finance-service sends `balanceDisplay` as a
 * signed, lakh-grouped, symbol-free string ("-12,345.67"). Naively prefixing
 * "₹" produced "₹-12,345.67"; the sign belongs before the symbol (same shape
 * as formatMoney: "-₹12,345.67"). A missing value reads "—", never "₹".
 */
export function formatBalanceDisplay(display: string | null | undefined): string {
  const s = (display ?? "").trim();
  if (s === "") return "—";
  return s.startsWith("-") ? `-₹${s.slice(1)}` : `₹${s}`;
}
