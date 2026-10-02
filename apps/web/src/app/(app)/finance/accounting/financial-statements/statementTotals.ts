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
  closingBalance: number | string;
}

/**
 * Expand a JS number's exponent form ("1e21", "1.5e-7") into plain decimal
 * digits so the same strict parser handles numbers and strings.
 */
function expandExponent(s: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (!m) return s;
  const [, sign, int = "", frac = "", exp = "0"] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  let out: string;
  if (point <= 0) out = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + out;
}

/**
 * Exact rupee amount -> paise bigint, or `null` when the input is not a clean
 * money value. ONE parser for numbers and strings: a number goes through
 * String(n) (exponent form expanded), then a strict `-?digits[.d{1,2}]` match.
 * Nothing is rounded and nothing is silently zeroed: null / NaN / Infinity,
 * "1e5", ".5", "5.", "+5", "1,000" and anything with more than 2 decimals
 * (e.g. 1.005, -0.125, 0.30000000000000004) are INVALID (`null`), so callers
 * must show "—" / withhold totals instead of fabricating a figure
 * (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03).
 */
export function parseRupeesExact(value: unknown): bigint | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    text = expandExponent(String(value));
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const [, sign, whole = "0", frac = ""] = m;
  const paise = BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -paise : paise;
}

/** Sum rupee amounts as BigInt paise; `null` if ANY value is invalid. */
export function sumRupeesToPaise(values: ReadonlyArray<unknown>): bigint | null {
  let total = 0n;
  for (const v of values) {
    const p = parseRupeesExact(v);
    if (p === null) return null;
    total += p;
  }
  return total;
}

export interface IncomeExpenditureTotals {
  totalIncome: bigint;
  totalExpenditure: bigint;
  /** income - expenditure; negative means a deficit */
  surplus: bigint;
  /** Rows of the relevant account classes whose closingBalance was not a clean money value. */
  invalidRows: number;
}

export function incomeExpenditureTotals(rows: readonly StatementRow[]): IncomeExpenditureTotals {
  let totalIncome = 0n;
  let totalExpenditure = 0n;
  let invalidRows = 0;
  for (const r of rows) {
    if (r.type !== "income" && r.type !== "expenditure") continue;
    const closing = parseRupeesExact(r.closingBalance);
    if (closing === null) { invalidRows += 1; continue; }
    // income is credit-normal (balance = cr - dr = closing);
    // expenditure is debit-normal (balance = dr - cr = -closing).
    if (r.type === "income") totalIncome += closing;
    else if (r.type === "expenditure") totalExpenditure += -closing;
  }
  return { totalIncome, totalExpenditure, surplus: totalIncome - totalExpenditure, invalidRows };
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
  let totalAssets = 0n;
  let totalLiabilities = 0n;
  let invalidRows = ie.invalidRows;
  for (const r of rows) {
    if (r.type !== "asset" && r.type !== "liability") continue;
    const closing = parseRupeesExact(r.closingBalance);
    if (closing === null) { invalidRows += 1; continue; }
    if (r.type === "asset") totalAssets += -closing; // debit-normal
    else if (r.type === "liability") totalLiabilities += closing; // credit-normal
  }
  const difference = totalAssets - (totalLiabilities + ie.surplus);
  // An invalid row means the equation cannot be checked: never "balanced".
  return { ...ie, invalidRows, totalAssets, totalLiabilities, difference, balanced: invalidRows === 0 && difference === 0n };
}
