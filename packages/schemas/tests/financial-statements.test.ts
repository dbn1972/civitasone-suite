import { describe, it, expect } from "vitest";
import { FinancialStatementSummaryListSchema, FinancialStatementSummarySchema } from "../src/web.js";
import { zMoneyMinorStrict } from "../src/money.js";

const ROW = {
  id: "h1", head: "h1", type: "income",
  openingBalance: "0", receipts: "150050", payments: "0", closingBalance: "150050",
};

describe("FinancialStatementSummarySchema wire contract (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03)", () => {
  it("accepts minor-unit decimal strings, including negatives and values above 2^53", () => {
    const parsed = FinancialStatementSummaryListSchema.parse([
      ROW,
      { ...ROW, id: "h2", type: "asset", receipts: "0", payments: "9007199254740993", closingBalance: "-9007199254740993" },
    ]);
    expect(parsed[1]?.closingBalance).toBe("-9007199254740993");
  });

  it.each(["abc", "", "12.50", "1e5", "1,000", " 5", "+5", "--5", "NaN", "Infinity"])(
    "rejects the non-numeric string %j in any balance field",
    (bad) => {
      for (const field of ["openingBalance", "receipts", "payments", "closingBalance"] as const) {
        expect(FinancialStatementSummarySchema.safeParse({ ...ROW, [field]: bad }).success).toBe(false);
      }
    },
  );

  it.each([150050, 1500.5, 0, Number.NaN, null, undefined, 9007199254740993n])(
    "rejects a non-string balance (%s): a rupee number must never be read as paise",
    (bad) => {
      expect(FinancialStatementSummarySchema.safeParse({ ...ROW, closingBalance: bad }).success).toBe(false);
    },
  );

  it("zMoneyMinorStrict is a plain base-10 integer string and nothing else", () => {
    expect(zMoneyMinorStrict.parse("-42")).toBe("-42");
    expect(zMoneyMinorStrict.safeParse(42).success).toBe(false);
    expect(zMoneyMinorStrict.safeParse("4.2").success).toBe(false);
  });
});
