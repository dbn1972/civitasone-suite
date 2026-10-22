import { sumMinor } from "@/lib/formatters";

/**
 * GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02/-03: statement-aware totals.
 *
 * GET /v1/finance/statements returns one trial-balance row per head with
 * receipts = credits and payments = debits, and closingBalance = credits -
 * debits. Every balance is a MINOR-unit (paise) base-10 integer STRING
 * (FinancialStatementSummarySchema in @civitasone/schemas): never a rupee
 * number and never a float. Summing those across account classes (the old
 * grand total) has no accounting meaning, so totals are derived per
 * statement, in BigInt paise via the shared `sumMinor` helper
 * (lib/formatters), which never converts through a double:
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
  /** credits - debits, paise as a base-10 integer string */
  closingBalance: string;
}

/**
 * Exact minor-unit (paise) amount -> bigint, or `null` when the input is not a
 * clean money value. Strict: ONLY a base-10 integer string (`-?digits`) is
 * valid. A JSON number (could be a rupee float from a mismatched server and
 * would be mis-scaled 100x), "12.50", "1e5", ".5", "+5", "1,000", "", null,
 * undefined and NaN are all INVALID (`null`), so callers must show "—" and
 * withhold totals instead of fabricating a figure.
 */
export function parseMinorExact(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^-?\d+$/.test(text) ? BigInt(text) : null;
}

/** Sum minor-unit amounts as BigInt (via the shared `sumMinor`); `null` if ANY value is invalid. */
export function sumMinorStrict(values: ReadonlyArray<unknown>): bigint | null {
  const clean: string[] = [];
  for (const v of values) {
    const p = parseMinorExact(v);
    if (p === null) return null;
    clean.push(p.toString());
  }
  const { total, invalid } = sumMinor(clean);
  return invalid === 0 ? total : null;
}

export interface IncomeExpenditureTotals {
  totalIncome: bigint;
  totalExpenditure: bigint;
  /** income - expenditure; negative means a deficit */
  surplus: bigint;
  /** Rows of the relevant account classes whose closingBalance was not a clean money value. */
  invalidRows: number;
}

/** closingBalance of the valid rows of one class, plus how many rows of that class were unreadable. */
function closingsOf(rows: readonly StatementRow[], type: string): { values: string[]; invalid: number } {
  const values: string[] = [];
  let invalid = 0;
  for (const r of rows) {
    if (r.type !== type) continue;
    const closing = parseMinorExact(r.closingBalance);
    if (closing === null) invalid += 1;
    else values.push(closing.toString());
  }
  return { values, invalid };
}

export function incomeExpenditureTotals(rows: readonly StatementRow[]): IncomeExpenditureTotals {
  const income = closingsOf(rows, "income");
  const expenditure = closingsOf(rows, "expenditure");
  // income is credit-normal (balance = cr - dr = closing);
  // expenditure is debit-normal (balance = dr - cr = -closing).
  const totalIncome = sumMinor(income.values).total;
  const totalExpenditure = -sumMinor(expenditure.values).total;
  return {
    totalIncome,
    totalExpenditure,
    surplus: totalIncome - totalExpenditure,
    invalidRows: income.invalid + expenditure.invalid,
  };
}

export interface BalanceSheetTotals extends IncomeExpenditureTotals {
  totalAssets: bigint;
  totalLiabilities: bigint;
  /** assets - (liabilities + surplus); 0n when the statement balances (meaningless if invalidRows > 0) */
  difference: bigint;
  balanced: boolean;
}

export function balanceSheetTotals(rows: readonly StatementRow[]): BalanceSheetTotals {
  const ie = incomeExpenditureTotals(rows);
  const assets = closingsOf(rows, "asset");
  const liabilities = closingsOf(rows, "liability");
  const invalidRows = ie.invalidRows + assets.invalid + liabilities.invalid;
  const totalAssets = -sumMinor(assets.values).total; // debit-normal
  const totalLiabilities = sumMinor(liabilities.values).total; // credit-normal
  const difference = totalAssets - (totalLiabilities + ie.surplus);
  // An invalid row means the equation cannot be checked: never "balanced".
  return { ...ie, invalidRows, totalAssets, totalLiabilities, difference, balanced: invalidRows === 0 && difference === 0n };
}
