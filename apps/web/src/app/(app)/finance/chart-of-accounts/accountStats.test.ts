import { describe, it, expect } from "vitest";
import { countAccountsByType, formatBalanceDisplay } from "./accountStats";

const a = (type: "asset" | "liability" | "equity" | "income" | "expense", status: "active" | "inactive" = "active") => ({ type, status });

describe("countAccountsByType (GAP-FINANCE-CHART-OF-ACCOUNTS-02)", () => {
  it("2 asset, 1 equity, 3 income -> Income/Expense is 3, equity counted on its own", () => {
    const c = countAccountsByType([a("asset"), a("asset"), a("equity"), a("income"), a("income"), a("income")]);
    expect(c).toMatchObject({ total: 6, assetLiability: 2, equity: 1, incomeExpense: 3 });
  });
  it("counts expense and liability, and only active heads as active", () => {
    const c = countAccountsByType([a("liability"), a("expense", "inactive")]);
    expect(c).toMatchObject({ assetLiability: 1, incomeExpense: 1, active: 1 });
  });
});

describe("formatBalanceDisplay (GAP-FINANCE-CHART-OF-ACCOUNTS-03)", () => {
  it("puts the sign before the rupee symbol", () => {
    expect(formatBalanceDisplay("-12,345.67")).toBe("-₹12,345.67");
    expect(formatBalanceDisplay("1,23,456.00")).toBe("₹1,23,456.00");
  });
  it("a missing value is a dash, not a bare rupee symbol", () => {
    expect(formatBalanceDisplay(undefined)).toBe("—");
    expect(formatBalanceDisplay("  ")).toBe("—");
  });
});
