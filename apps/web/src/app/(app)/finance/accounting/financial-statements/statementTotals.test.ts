import { describe, it, expect } from "vitest";
import { balanceSheetTotals, incomeExpenditureTotals, rupeesNumberToPaise } from "./statementTotals";

describe("statementTotals (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02)", () => {
  it("income 1000 and expenditure 700 give a surplus of 300", () => {
    const t = incomeExpenditureTotals([
      { type: "income", closingBalance: 1000 }, // credit-normal
      { type: "expenditure", closingBalance: -700 }, // debit-normal
    ]);
    expect(t.totalIncome).toBe(100000n);
    expect(t.totalExpenditure).toBe(70000n);
    expect(t.surplus).toBe(30000n);
  });

  it("reports a deficit as a negative surplus", () => {
    const t = incomeExpenditureTotals([
      { type: "income", closingBalance: 100 },
      { type: "expenditure", closingBalance: -250.5 },
    ]);
    expect(t.surplus).toBe(-15050n);
  });

  it("flags an unbalanced balance sheet and accepts a balanced one", () => {
    const balanced = balanceSheetTotals([
      { type: "asset", closingBalance: -1000 },
      { type: "liability", closingBalance: 700 },
      { type: "income", closingBalance: 500 },
      { type: "expenditure", closingBalance: -200 },
    ]);
    expect(balanced.totalAssets).toBe(100000n);
    expect(balanced.totalLiabilities).toBe(70000n);
    expect(balanced.surplus).toBe(30000n);
    expect(balanced.balanced).toBe(true);

    const unbalanced = balanceSheetTotals([
      { type: "asset", closingBalance: -1000 },
      { type: "liability", closingBalance: 600 },
    ]);
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.difference).toBe(40000n);
  });

  it("converts rupee floats to exact paise (no 0.1+0.2 drift)", () => {
    expect(rupeesNumberToPaise(0.1) + rupeesNumberToPaise(0.2)).toBe(30n);
    expect(rupeesNumberToPaise(Number.NaN)).toBe(0n);
  });
});
