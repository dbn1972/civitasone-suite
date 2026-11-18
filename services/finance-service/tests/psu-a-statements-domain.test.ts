/**
 * PSU v1-A (pure): per-tenant framework resolution, SOCIE, P&L prior-year comparatives, and the settings guard.
 */
import { describe, it, expect } from "vitest";
import { buildCommercialSet, changesInEquity, classify, type CommercialRow, type PresentationConfig, type ProfitAndLoss, type TradingPl } from "../src/modules/financial-statements/commercial-statements.js";
import { resolveFramework, frameworkFromEnv } from "../src/modules/financial-statements/commercial-statements-repo.js";
import { statementSetFor } from "../src/modules/financial-statements/statement-set.js";
import { SETTINGS_DEFAULTS, isRelaxingControl, toAccountingStandard, ACCOUNTING_STANDARDS } from "../src/modules/approvals/domain.js";

const set = (...c: string[]) => new Set(c);
const CFG: PresentationConfig = {
  accumulatedFund: "3100", fixedAssetCodes: set("1200"), accumDepCodes: set("1250"), cashCodes: set("1100"), borrowingCodes: set("2400"),
  otherIncomeCodes: set("4400"), directExpenseCodes: set("5400"), employeeCodes: set(), financeCostCodes: set("6200"), depreciationCodes: set("5100"), taxExpenseCodes: set(),
  dividendCodes: set("3200"),
};
const row = (code: string, cls: string | null, dr: bigint, cr: bigint, opening = 0n): CommercialRow =>
  ({ code, name: `Head ${code}`, statementClass: cls, openingMinor: opening, debitMinor: dr, creditMinor: cr, closingMinor: opening + dr - cr });

// Current year: capital 10,00,000 (opened 5,00,000, +5,00,000), fund b/f 3,00,000, reserve 3200 opened 1,00,000 +50,000 -20,000 dividend; PAT 5,00,000.
const CUR: CommercialRow[] = [
  row("1100", "asset", 2000000n, 0n, 800000n),
  row("3000", "equity", 0n, 500000n, -500000n), row("3100", "reserve", 0n, 0n, -300000n), row("3200", "reserve", 20000n, 50000n, -100000n),
  row("4010", "income", 0n, 700000n), row("5400", "expense", 200000n, 0n),
];
// 1100: assets must balance: cap 1000000 + fund 300000 + res 130000 + PAT 500000 = 1930000 ; fix 1100 closing accordingly below.
CUR[0] = row("1100", "asset", 0n, 0n, 1930000n);
const PRIOR: CommercialRow[] = [row("4010", "income", 0n, 400000n), row("5400", "expense", 100000n, 0n), row("4400", "income", 0n, 5000n)];

describe("framework resolution: stored per-tenant value wins, NULL falls back to the deployment default", () => {
  it("stored value overrides the env either way; unset falls back to the env (back-compat), default AS", () => {
    expect(resolveFramework("as", { FINANCE_COMMERCIAL_ACCOUNTING_STANDARD: "ind_as" })).toBe("as");
    expect(resolveFramework("ind_as", {})).toBe("ind_as");
    expect(resolveFramework(null, { FINANCE_COMMERCIAL_ACCOUNTING_STANDARD: "ind_as" })).toBe("ind_as");
    expect(resolveFramework(null, {})).toBe("as");
    expect(frameworkFromEnv({})).toBe("as");
  });
  it("the stored value drives markers.framework", () => {
    const o = { family: "schedule_iii" as const, fy: "2026-27", accountingBasis: "accrual" };
    expect(buildCommercialSet(CUR, CFG, { ...o, framework: "ind_as" }).markers.framework).toBe("ind_as");
    expect(buildCommercialSet(CUR, CFG, { ...o, framework: "as" }).markers.framework).toBe("as");
  });
  it("accounting_standard is a known set, is a second-admin setting, and defaults to NULL", () => {
    expect(ACCOUNTING_STANDARDS).toEqual(["as", "ind_as"]);
    expect(toAccountingStandard("ind_as")).toBe("ind_as");
    expect(toAccountingStandard("ifrs")).toBeNull();
    expect(SETTINGS_DEFAULTS.accountingStandard).toBeNull();
    expect(isRelaxingControl(SETTINGS_DEFAULTS, { accountingStandard: "ind_as" })).toBe(true);
    expect(isRelaxingControl({ ...SETTINGS_DEFAULTS, accountingStandard: "as" }, { accountingStandard: "as" })).toBe(false);
  });
});

describe("Statement of Changes in Equity", () => {
  const socie = changesInEquity(classify(CUR), CFG);
  it("opening -> movements -> closing per head; PAT on its own line; dividends split from other deductions", () => {
    const by = (c: string | null) => socie.rows.find((r) => r.code === c)!;
    expect(by("3000")).toMatchObject({ component: "equity_share_capital", openingMinor: "500000", additionsMinor: "500000", closingMinor: "1000000" });
    expect(by("3100")).toMatchObject({ component: "reserves_and_surplus", openingMinor: "300000", closingMinor: "300000" });
    expect(by("3200")).toMatchObject({ openingMinor: "100000", additionsMinor: "50000", dividendsMinor: "20000", otherDeductionsMinor: "0", closingMinor: "130000" });
    expect(by(null)).toMatchObject({ profitForYearMinor: "500000", closingMinor: "500000" });
  });
  it("closing = opening + profit + additions - deductions, and ties to the Balance Sheet equity section", () => {
    const t = socie.totals;
    expect(BigInt(t.openingMinor) + BigInt(t.profitForYearMinor) + BigInt(t.additionsMinor) - BigInt(t.dividendsMinor) - BigInt(t.otherDeductionsMinor)).toBe(BigInt(t.closingMinor));
    expect(t.closingMinor).toBe("1930000");
    expect(socie.tiesToBalanceSheet).toBe(true);
    expect(socie.balanceSheetEquityMinor).toBe(t.closingMinor);
  });
  it("only the Schedule III family carries it", () => {
    const o = { fy: "2026-27", framework: "as" as const, accountingBasis: "accrual" };
    expect(buildCommercialSet(CUR, CFG, { ...o, family: "schedule_iii" }).changesInEquity).toBeDefined();
    expect(buildCommercialSet(CUR, CFG, { ...o, family: "trading_pl_bs" }).changesInEquity).toBeUndefined();
    expect(statementSetFor("commercial", "company").statements.map((s) => s.key)).toContain("changes_in_equity");
    expect(statementSetFor("commercial", "proprietorship").statements.map((s) => s.key)).not.toContain("changes_in_equity");
    expect(statementSetFor("govt").statements.map((s) => s.key)).not.toContain("changes_in_equity");
  });
});

describe("P&L prior-year comparatives", () => {
  const o = { family: "schedule_iii" as const, fy: "2026-27", framework: "as" as const, accountingBasis: "accrual" };
  it("prior-year column per line / group and prior-year totals from the previous FY's own movements", () => {
    const pl = buildCommercialSet(CUR, CFG, { ...o, priorFy: "2025-26", priorRows: PRIOR }).profitAndLoss as ProfitAndLoss;
    expect(pl.profitAfterTaxMinor).toBe("500000");
    expect(pl.priorYear).toMatchObject({ fiscalYear: "2025-26", totalRevenueMinor: "405000", totalExpensesMinor: "100000", profitAfterTaxMinor: "305000" });
    const rev = pl.groups.find((g) => g.key === "revenue_from_operations")!;
    expect(rev.lines.find((l) => l.code === "4010")).toMatchObject({ amountMinor: "700000", priorYearMinor: "400000" });
    expect(rev.priorYearTotalMinor).toBe("400000");
    // a head with prior-year activity only still prints, with a current amount of 0
    const oi = pl.groups.find((g) => g.key === "other_income")!;
    expect(oi.lines.find((l) => l.code === "4400")).toMatchObject({ amountMinor: "0", priorYearMinor: "5000" });
  });
  it("without a prior year the P&L is exactly as before (no priorYear key)", () => {
    const pl = buildCommercialSet(CUR, CFG, o).profitAndLoss as ProfitAndLoss;
    expect(pl.priorYear).toBeUndefined();
    expect(pl.groups.every((g) => g.priorYearTotalMinor === undefined)).toBe(true);
  });
  it("the ITR family gets the comparative too", () => {
    const pl = buildCommercialSet(CUR, CFG, { ...o, family: "trading_pl_bs", priorFy: "2025-26", priorRows: PRIOR }).profitAndLoss as TradingPl;
    expect(pl.priorYear).toMatchObject({ fiscalYear: "2025-26", grossProfitMinor: "300000", netProfitMinor: "305000" });
  });
});
