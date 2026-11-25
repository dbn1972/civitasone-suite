import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * GET /v1/finance/statements/{balance-sheet,income-expenditure,receipts-payments}
 * (finance-service financial-statements/routes.ts). All three take ?fy=YYYY-YY and are
 * finance_officer / finance_admin / super_admin / audit_officer only. Money is paise as
 * integer strings; an unreadable figure maps to null so the page shows "—", never a fake 0.
 */

export type StatementLine = { code: string; name: string; balanceMinor: string | null };

export type BalanceSheet = {
  fiscalYear: string;
  asOf: string;
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  surplusDeficitMinor: string | null;
  totalAssetsMinor: string | null;
  totalLiabilitiesMinor: string | null;
  accumulatedFundsMinor: string | null;
  totalLiabilitiesAndEquityMinor: string | null;
  balanced: boolean | null;
  differenceMinor: string | null;
};

export type IncomeExpenditure = {
  fiscalYear: string;
  periodStart: string;
  periodEnd: string;
  income: StatementLine[];
  expenditure: StatementLine[];
  totalIncomeMinor: string | null;
  totalExpenditureMinor: string | null;
  surplusDeficitMinor: string | null;
  result: "surplus" | "deficit" | null;
};

export type ReceiptsPaymentsRow = {
  account: string;
  openingBalanceMinor: string | null;
  totalReceiptsMinor: string | null;
  totalPaymentsMinor: string | null;
  closingBalanceMinor: string | null;
};
export type ReceiptsPayments = { fiscalYear: string; rows: ReceiptsPaymentsRow[] };

/** Integer string (or safe integer number) -> canonical minor-unit string; anything else -> null. */
export function minorOrNull(v: unknown): string | null {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return v.trim();
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return null;
}

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function lines(v: unknown): StatementLine[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = rec(x);
    return r ? [{ code: str(r.code), name: str(r.name), balanceMinor: minorOrNull(r.balanceMinor) }] : [];
  });
}

export function mapBalanceSheet(p: unknown): BalanceSheet | null {
  const r = rec(p);
  if (!r || typeof r.fiscalYear !== "string") return null;
  const t = rec(r.totals) ?? {};
  const c = rec(r.balanceCheck) ?? {};
  return {
    fiscalYear: r.fiscalYear,
    asOf: str(r.asOf),
    assets: lines(r.assets),
    liabilities: lines(r.liabilities),
    equity: lines(r.equity),
    surplusDeficitMinor: minorOrNull(r.surplusDeficitMinor),
    totalAssetsMinor: minorOrNull(t.totalAssetsMinor),
    totalLiabilitiesMinor: minorOrNull(t.totalLiabilitiesMinor),
    accumulatedFundsMinor: minorOrNull(t.accumulatedFundsMinor),
    totalLiabilitiesAndEquityMinor: minorOrNull(t.totalLiabilitiesAndEquityMinor),
    balanced: typeof c.balanced === "boolean" ? c.balanced : null,
    differenceMinor: minorOrNull(c.differenceMinor),
  };
}

export function mapIncomeExpenditure(p: unknown): IncomeExpenditure | null {
  const r = rec(p);
  if (!r || typeof r.fiscalYear !== "string") return null;
  return {
    fiscalYear: r.fiscalYear,
    periodStart: str(r.periodStart),
    periodEnd: str(r.periodEnd),
    income: lines(r.income),
    expenditure: lines(r.expenditure),
    totalIncomeMinor: minorOrNull(r.totalIncomeMinor),
    totalExpenditureMinor: minorOrNull(r.totalExpenditureMinor),
    surplusDeficitMinor: minorOrNull(r.surplusDeficitMinor),
    result: r.result === "surplus" || r.result === "deficit" ? r.result : null,
  };
}

export function mapReceiptsPayments(p: unknown): ReceiptsPayments | null {
  const r = rec(p);
  if (!r || typeof r.fiscalYear !== "string" || !Array.isArray(r.data)) return null;
  const rows = r.data.flatMap((x) => {
    const d = rec(x);
    return d
      ? [{
          account: str(d.bank_or_cash),
          openingBalanceMinor: minorOrNull(d.opening_balance),
          totalReceiptsMinor: minorOrNull(d.total_receipts),
          totalPaymentsMinor: minorOrNull(d.total_payments),
          closingBalanceMinor: minorOrNull(d.closing_balance),
        }]
      : [];
  });
  return { fiscalYear: r.fiscalYear, rows };
}

function load<T>(path: string, fy: string, key: string, map: (p: unknown) => T | null): Promise<LoaderResult<T | null>> {
  return fetchJson<unknown, T | null>(`/api/v1/finance/statements/${path}?fy=${encodeURIComponent(fy)}`, null, {
    revalidateSeconds: 0,
    telemetryKey: `finance.statements.${key}`,
    mapResponse: map,
  });
}

export const getBalanceSheet = (fy: string) => load("balance-sheet", fy, "balanceSheet", mapBalanceSheet);
export const getIncomeExpenditure = (fy: string) => load("income-expenditure", fy, "incomeExpenditure", mapIncomeExpenditure);
export const getReceiptsPayments = (fy: string) => load("receipts-payments", fy, "receiptsPayments", mapReceiptsPayments);
