import { describe, it, expect } from "vitest";
import { sumMinor } from "@/lib/formatters";
import { balanceSheetTotals, incomeExpenditureTotals, parseMinorExact, sumMinorStrict } from "./statementTotals";

// Every closingBalance below is PAISE as a base-10 integer string (the wire
// contract of GET /v1/finance/statements), e.g. "100000" = Rs 1,000.00.
describe("statementTotals (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02)", () => {
  it("income 1000 and expenditure 700 give a surplus of 300", () => {
    const t = incomeExpenditureTotals([
      { type: "income", closingBalance: "100000" }, // credit-normal
      { type: "expenditure", closingBalance: "-70000" }, // debit-normal
    ]);
    expect(t.totalIncome).toBe(100000n);
    expect(t.totalExpenditure).toBe(70000n);
    expect(t.surplus).toBe(30000n);
  });

  it("reports a deficit as a negative surplus", () => {
    const t = incomeExpenditureTotals([
      { type: "income", closingBalance: "10000" },
      { type: "expenditure", closingBalance: "-25050" },
    ]);
    expect(t.surplus).toBe(-15050n);
  });

  it("flags an unbalanced balance sheet and accepts a balanced one", () => {
    const balanced = balanceSheetTotals([
      { type: "asset", closingBalance: "-100000" },
      { type: "liability", closingBalance: "70000" },
      { type: "income", closingBalance: "50000" },
      { type: "expenditure", closingBalance: "-20000" },
    ]);
    expect(balanced.totalAssets).toBe(100000n);
    expect(balanced.totalLiabilities).toBe(70000n);
    expect(balanced.surplus).toBe(30000n);
    expect(balanced.balanced).toBe(true);

    const unbalanced = balanceSheetTotals([
      { type: "asset", closingBalance: "-100000" },
      { type: "liability", closingBalance: "60000" },
    ]);
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.difference).toBe(40000n);
  });

  it("an invalid closing balance makes the balance sheet 'not balanced' instead of skipping the row", () => {
    const t = balanceSheetTotals([
      { type: "asset", closingBalance: "-100000" },
      { type: "liability", closingBalance: "1e3" },
    ]);
    expect(t.invalidRows).toBe(1);
    expect(t.balanced).toBe(false);
    const ok = balanceSheetTotals([
      { type: "asset", closingBalance: "-100000" },
      { type: "liability", closingBalance: "100000" },
    ]);
    expect(ok.balanced).toBe(true);
    expect(incomeExpenditureTotals([{ type: "income", closingBalance: Number.NaN as unknown as string }]).invalidRows).toBe(1);
  });

  it("a JSON number is invalid: a rupee float must never be read as paise", () => {
    const t = incomeExpenditureTotals([{ type: "income", closingBalance: 100000 as unknown as string }]);
    expect(t.invalidRows).toBe(1);
    expect(t.totalIncome).toBe(0n);
  });

  it("totals stay exact above 2^53 paise (no double arithmetic)", () => {
    const t = incomeExpenditureTotals([
      { type: "income", closingBalance: "9007199254740993" },
      { type: "income", closingBalance: "1" },
      { type: "expenditure", closingBalance: "-9007199254740995" },
    ]);
    expect(t.totalIncome).toBe(9007199254740994n);
    expect(t.totalExpenditure).toBe(9007199254740995n);
    expect(t.surplus).toBe(-1n);
    const bs = balanceSheetTotals([
      { type: "asset", closingBalance: "-9007199254740993" },
      { type: "liability", closingBalance: "9007199254740993" },
    ]);
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe(0n);
  });
});

describe("shared sumMinor / sumMinorStrict (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03)", () => {
  it("sumMinor(['9007199254740993','1']) = 9007199254740994n (the shared helper the page sums with)", () => {
    expect(sumMinor(["9007199254740993", "1"])).toEqual({ total: 9007199254740994n, invalid: 0 });
    expect(sumMinorStrict(["9007199254740993", "1"])).toBe(9007199254740994n);
  });
  it("strings are added, never concatenated", () => {
    expect(sumMinorStrict(["100", "250", "-50"])).toBe(300n);
  });
  it("is null when any value is invalid (an unreadable figure is not skipped)", () => {
    expect(sumMinorStrict(["100", "abc"])).toBeNull();
    expect(sumMinorStrict(["100", ""])).toBeNull();
    expect(sumMinorStrict(["100", null])).toBeNull();
  });
});

describe("parseMinorExact (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03)", () => {
  it("parses a base-10 integer string exactly, including above 2^53 and negatives", () => {
    expect(parseMinorExact("10000010")).toBe(10000010n);
    expect(parseMinorExact("-1250")).toBe(-1250n);
    expect(parseMinorExact("900719925474099301")).toBe(900719925474099301n);
    expect(parseMinorExact("0")).toBe(0n);
    expect(parseMinorExact(" 42 ")).toBe(42n);
  });
  it.each([
    null, undefined, Number.NaN, Infinity, 0, 100000, 1e21, 1.5,
    "1e5", ".5", "5.", "+5", "1,000", "12.50", "1.005", "", "abc", "--5", {}, [],
  ])("anything else (%s) is invalid, never rounded or zeroed", (v) => {
    expect(parseMinorExact(v)).toBeNull();
  });
});
