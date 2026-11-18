/**
 * MSME M8 (pure): entity-type resolver + the two statement families. Classification is the STORED statement_class, never the code.
 */
import { describe, it, expect } from "vitest";
import { statementSetFor } from "../src/modules/financial-statements/statement-set.js";
import {
  buildCommercialSet, classify, StatementClassMissingError, type CommercialRow, type PresentationConfig, type ProfitAndLoss, type TradingPl,
} from "../src/modules/financial-statements/commercial-statements.js";

const set = (...c: string[]) => new Set(c);
const CFG: PresentationConfig = {
  accumulatedFund: "3100", fixedAssetCodes: set("1200"), accumDepCodes: set("1250"), cashCodes: set("1100"), borrowingCodes: set("2400"),
  otherIncomeCodes: set("4400"), directExpenseCodes: set("5400"), employeeCodes: set(), financeCostCodes: set("6200"), depreciationCodes: set("5100"), taxExpenseCodes: set(),
};
const row = (code: string, cls: string | null, dr: bigint, cr: bigint, opening = 0n): CommercialRow =>
  ({ code, name: `Head ${code}`, statementClass: cls, openingMinor: opening, debitMinor: dr, creditMinor: cr, closingMinor: opening + dr - cr });
const ROWS: CommercialRow[] = [
  row("1100", "asset", 760000n, 0n), row("1200", "asset", 300000n, 0n), row("1250", "asset", 0n, 30000n), row("1300", "asset", 590000n, 0n), row("1700", "asset", 36000n, 0n),
  row("2300", "current_liability", 0n, 90000n), row("2050", "current_liability", 0n, 236000n), row("2400", "current_liability", 0n, 100000n),
  row("3000", "equity", 0n, 1000000n),
  row("4010", "income", 0n, 500000n), row("4400", "income", 0n, 10000n),
  row("5400", "expense", 200000n, 0n), row("5100", "expense", 30000n, 0n), row("5410", "expense", 50000n, 0n),
];

describe("resolver: keyed on the stored entity_type", () => {
  it("company -> schedule_iii; llp -> schedule_iii + Form 8/11 v2 marker; partnership / proprietorship -> trading_pl_bs", () => {
    expect(statementSetFor("commercial", "company")).toMatchObject({ id: "commercial", available: true, family: "schedule_iii" });
    expect(statementSetFor("commercial", "company").statements.map((s) => s.key)).toEqual(["profit_and_loss", "balance_sheet", "changes_in_equity", "cash_flow", "notes"]);
    expect(statementSetFor("commercial", "llp")).toMatchObject({ family: "schedule_iii", markers: ["LLP_FORM_8_11_V2"] });
    for (const e of ["partnership", "proprietorship"]) {
      const s = statementSetFor("commercial", e);
      expect(s.family).toBe("trading_pl_bs");
      expect(s.statements.map((x) => x.key)).toEqual(["trading_account", "profit_and_loss", "balance_sheet"]);
    }
  });
  it("commercial with no / unknown entity_type is unavailable (nothing inferred); govt + nonprofit are unchanged by any entity_type", () => {
    expect(statementSetFor("commercial", null)).toMatchObject({ available: false, statements: [] });
    expect(statementSetFor("commercial", "trust")).toMatchObject({ available: false });
    expect(statementSetFor("govt", "company")).toEqual(statementSetFor("govt"));
    expect(statementSetFor("nonprofit", "company")).toEqual(statementSetFor("nonprofit"));
    expect(Object.keys(statementSetFor("govt")).sort()).toEqual(["available", "fundWise", "id", "requiresFundAccounting", "statements"]);
  });
});

describe("classification is the stored statement_class, never the code prefix", () => {
  it("2300 GST Payable lands in current liabilities; a 1900-coded current_liability is a liability, a 2900-coded asset is an asset", () => {
    const rows = [...ROWS, row("1900", "current_liability", 0n, 5000n), row("2900", "asset", 5000n, 0n)];
    const bs = buildCommercialSet(rows, CFG, { family: "schedule_iii", fy: "2026-27", framework: "as", accountingBasis: "accrual" }).balanceSheet;
    const cl = bs.equityAndLiabilities.find((g) => g.key === "current_liabilities")!;
    expect(cl.lines.map((l) => l.code)).toEqual(expect.arrayContaining(["2300", "1900"]));
    expect(cl.lines.find((l) => l.code === "2300")!.amountMinor).toBe("90000");
    expect(bs.assets.find((g) => g.key === "current_assets")!.lines.map((l) => l.code)).toContain("2900");
    expect(bs.balanced).toBe(true);
  });
  it("a moving head with no stored class refuses (fail-closed), never guessed from its code", () => {
    expect(() => classify([row("2300", null, 0n, 1n)])).toThrow(StatementClassMissingError);
    expect(() => classify([row("2300", "bogus", 0n, 1n)])).toThrow(/2300/);
    expect(classify([row("2300", null, 0n, 0n)])).toEqual([]); // untouched head: ignored
  });
});

describe("Schedule III family (company)", () => {
  const out = buildCommercialSet(ROWS, CFG, { family: "schedule_iii", fy: "2026-27", framework: "as", accountingBasis: "accrual" });
  it("P&L: revenue 5,00,000 + other income 10,000 - expenses 2,80,000 = PAT 2,30,000", () => {
    const pl = out.profitAndLoss as ProfitAndLoss;
    expect(pl.totalRevenueMinor).toBe("510000");
    expect(pl.totalExpensesMinor).toBe("280000");
    expect(pl.profitAfterTaxMinor).toBe("230000");
    expect(pl.result).toBe("profit");
  });
  it("Balance Sheet balances: 16,56,000 each side; surplus joins reserves; PPE is net of depreciation", () => {
    const bs = out.balanceSheet;
    expect(bs.totalAssetsMinor).toBe("1656000");
    expect(bs.totalEquityAndLiabilitiesMinor).toBe("1656000");
    expect(bs.balanced).toBe(true);
    expect(bs.assets[0]!.totalMinor).toBe("270000");
  });
  it("Cash Flow reconciles to the cash head: -40,000 operating, -3,00,000 investing, +11,00,000 financing = 7,60,000", () => {
    const cf = out.cashFlow!;
    expect([cf.netOperatingMinor, cf.netInvestingMinor, cf.netFinancingMinor]).toEqual(["-40000", "-300000", "1100000"]);
    expect(cf.closingCashMinor).toBe("760000");
    expect(cf.reconciles).toBe(true);
    expect(out.tradingAccount).toBeUndefined();
  });
  it("framework toggle + CA-VERIFY markers present; LLP flag only when llp", () => {
    expect(out.markers.framework).toBe("as");
    expect(out.markers.caVerify.length).toBeGreaterThan(0);
    expect(out.markers.llpForm8Form11).toBeUndefined();
    expect(buildCommercialSet(ROWS, CFG, { family: "schedule_iii", fy: "2026-27", framework: "ind_as", accountingBasis: "accrual", llp: true }).markers).toMatchObject({ framework: "ind_as", llpForm8Form11: "v2" });
    expect(out.notes.length).toBeGreaterThan(0);
  });
});

describe("Trading + P&L + Balance Sheet family (partnership / proprietorship)", () => {
  const out = buildCommercialSet(ROWS, CFG, { family: "trading_pl_bs", fy: "2026-27", framework: "as", accountingBasis: "accrual" });
  it("Trading: sales 5,00,000 - purchases 2,00,000 = gross profit 3,00,000; P&L net profit 2,30,000; no cash-flow statement", () => {
    expect(out.tradingAccount!.grossProfitMinor).toBe("300000");
    const pl = out.profitAndLoss as TradingPl;
    expect(pl.netProfitMinor).toBe("230000");
    expect(pl.result).toBe("net_profit");
    expect(out.cashFlow).toBeUndefined();
  });
  it("Balance Sheet balances and uses the capital-account labels", () => {
    expect(out.balanceSheet.balanced).toBe(true);
    expect(out.balanceSheet.equityAndLiabilities[0]!.label).toMatch(/capital account/i);
  });
});
