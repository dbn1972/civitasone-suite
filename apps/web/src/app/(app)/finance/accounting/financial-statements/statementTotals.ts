/**
 * GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02: statement-aware totals.
 *
 * GET /v1/finance/statements returns one trial-balance row per head with
 * receipts = credits and payments = debits (rupees, as JSON numbers) and
 * closingBalance = credits - debits. Summing those across account classes
 * (the old grand total) has no accounting meaning, so totals are derived per
 * statement, in BigInt paise (rupee figures are converted once, rounded to
 * the paisa, then never touched by float arithmetic again):
 *
 *   - I&E: Total Income, Total Expenditure, Surplus/(Deficit)
 *   - Balance Sheet: Total Assets, Total Liabilities, current-period
 *     surplus/(deficit) and a Balanced/Unbalanced check
 *     (assets = liabilities + (income - expenditure), the same equation the
 *     finance-service balance-sheet endpoint uses)
 *   - R&P: NO grand total. The list endpoint does not mark which heads are
 *     cash/bank, so any total would still mix account classes.
 */
export interface StatementRow {
  type: "asset" | "liability" | "income" | "expenditure" | string;
  /** credits - debits, rupees */
  closingBalance: number;
}

/** Rupee JSON number -> paise bigint (rounded once at the boundary). */
export function rupeesNumberToPaise(rupees: number): bigint {
  return Number.isFinite(rupees) ? BigInt(Math.round(rupees * 100)) : 0n;
}

export interface IncomeExpenditureTotals {
  totalIncome: bigint;
  totalExpenditure: bigint;
  /** income - expenditure; negative means a deficit */
  surplus: bigint;
}

export function incomeExpenditureTotals(rows: readonly StatementRow[]): IncomeExpenditureTotals {
  let totalIncome = 0n;
  let totalExpenditure = 0n;
  for (const r of rows) {
    const closing = rupeesNumberToPaise(r.closingBalance);
    // income is credit-normal (balance = cr - dr = closing);
    // expenditure is debit-normal (balance = dr - cr = -closing).
    if (r.type === "income") totalIncome += closing;
    else if (r.type === "expenditure") totalExpenditure += -closing;
  }
  return { totalIncome, totalExpenditure, surplus: totalIncome - totalExpenditure };
}

export interface BalanceSheetTotals extends IncomeExpenditureTotals {
  totalAssets: bigint;
  totalLiabilities: bigint;
  /** assets - (liabilities + surplus); 0n when the statement balances */
  difference: bigint;
  balanced: boolean;
}

export function balanceSheetTotals(rows: readonly StatementRow[]): BalanceSheetTotals {
  const ie = incomeExpenditureTotals(rows);
  let totalAssets = 0n;
  let totalLiabilities = 0n;
  for (const r of rows) {
    const closing = rupeesNumberToPaise(r.closingBalance);
    if (r.type === "asset") totalAssets += -closing; // debit-normal
    else if (r.type === "liability") totalLiabilities += closing; // credit-normal
  }
  const difference = totalAssets - (totalLiabilities + ie.surplus);
  return { ...ie, totalAssets, totalLiabilities, difference, balanced: difference === 0n };
}
