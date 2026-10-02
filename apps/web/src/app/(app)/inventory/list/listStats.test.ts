import { describe, it, expect } from "vitest";
import { stockListStats } from "./listStats";

const it_ = (totalValue: number | null, isLowStock: boolean | null) => ({ totalValue, isLowStock });

describe("stockListStats", () => {
  it("a failed load is all dashes, never zero", () => {
    expect(stockListStats([], true)).toMatchObject({ total: null, lowStock: null, valueText: null });
  });
  it("excludes unknown rows from low-stock and value, and says how many were valued", () => {
    const s = stockListStats([it_(12500, true), it_(500, false), it_(null, null)], false);
    expect(s.total).toBe(3);
    expect(s.lowStock).toBe(1);
    expect(s.valueText).toBe("₹130.00");
    expect(s.valueLabel).toBe("Stock Value (2 of 3 items valued)");
  });
  it("no valued item gives a null value, not Rs 0", () => {
    expect(stockListStats([it_(null, null)], false).valueText).toBeNull();
  });
  it("a reported zero value is a real 0", () => {
    expect(stockListStats([it_(0, false)], false).valueText).toBe("₹0.00");
  });
  it("a genuinely empty healthy list has zero counts and no value", () => {
    expect(stockListStats([], false)).toMatchObject({ total: 0, lowStock: 0, valueText: null, valueLabel: "Stock Value" });
  });
});
