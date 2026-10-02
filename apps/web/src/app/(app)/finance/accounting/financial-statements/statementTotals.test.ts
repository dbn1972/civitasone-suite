import { describe, it, expect } from "vitest";
import { balanceSheetTotals, incomeExpenditureTotals, parseRupeesExact, sumRupeesToPaise } from "./statementTotals";

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

  it("an invalid closing balance makes the balance sheet 'not balanced' instead of skipping the row", () => {
    const t = balanceSheetTotals([
      { type: "asset", closingBalance: -1000 },
      { type: "liability", closingBalance: "1e3" },
    ]);
    expect(t.invalidRows).toBe(1);
    expect(t.balanced).toBe(false);
    const ok = balanceSheetTotals([
      { type: "asset", closingBalance: -1000 },
      { type: "liability", closingBalance: "1000" },
    ]);
    expect(ok.balanced).toBe(true);
    expect(incomeExpenditureTotals([{ type: "income", closingBalance: Number.NaN }]).invalidRows).toBe(1);
  });
});

describe("parseRupeesExact (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03)", () => {
  it("numbers and strings share one exact parser", () => {
    expect(parseRupeesExact(100000.1)).toBe(10000010n);
    expect(parseRupeesExact("100000.10")).toBe(10000010n);
    expect(parseRupeesExact(-12.5)).toBe(-1250n);
    expect(parseRupeesExact("9007199254740993.01")).toBe(900719925474099301n);
    expect(parseRupeesExact(1e21)).toBe(100000000000000000000000n);
    expect(parseRupeesExact(0)).toBe(0n);
  });
  it("rejects (null) rather than rounding or zeroing: 1.005, -0.125, 0.1+0.2", () => {
    expect(parseRupeesExact(1.005)).toBeNull();
    expect(parseRupeesExact("1.005")).toBeNull();
    expect(parseRupeesExact(-0.125)).toBeNull();
    expect(parseRupeesExact("-0.125")).toBeNull();
    expect(parseRupeesExact(0.1 + 0.2)).toBeNull();
    // the operands themselves are fine and sum exactly
    expect(sumRupeesToPaise([0.1, 0.2])).toBe(30n);
  });
  it.each([null, undefined, Number.NaN, Infinity, "1e5", ".5", "5.", "+5", "1,000", "", "abc", {}, 1e-7])(
    "garbage %s is invalid",
    (v) => expect(parseRupeesExact(v)).toBeNull(),
  );
  it("sums as BigInt (strings are added, never concatenated); null when any value is invalid", () => {
    expect(sumRupeesToPaise(["1", "2", 3, "0.50"])).toBe(650n);
    expect(sumRupeesToPaise(["1", "x"])).toBeNull();
  });
});
