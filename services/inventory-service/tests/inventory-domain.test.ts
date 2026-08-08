/**
 * Inventory Service — movements domain. ~5 packs.
 */
import { describe, it, expect } from "vitest";
import { weightedAvgRate, assertSufficientStock, valuationMinor, isLowStock, suggestedReorderQty } from "../src/modules/movements/domain.js";

describe("weightedAvgRate — moving average cost", () => {
  it("blends existing + receipt", () => {
    // (10*100 + 5*200) / 15 = 2000/15 = 133 (floor)
    expect(weightedAvgRate({ qty: 10, rateMinor: 100n }, 5, 200n)).toBe(133n);
  });
  it("first receipt: rate = receipt rate", () => {
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 10, 500n)).toBe(500n);
  });
  it("zero combined qty → 0", () => {
    expect(weightedAvgRate({ qty: 0, rateMinor: 0n }, 0, 100n)).toBe(0n);
  });
});

describe("assertSufficientStock", () => {
  it("passes when available >= requested", () => expect(() => assertSufficientStock(10, 5)).not.toThrow());
  it("throws INSUFFICIENT_STOCK", () => expect(() => assertSufficientStock(5, 6)).toThrow());
});

describe("valuationMinor", () => {
  it("qty * rate (bigint)", () => expect(valuationMinor(100, 50_00n)).toBe(500_000n));
});

describe("isLowStock + suggestedReorderQty", () => {
  it("low when at/below reorder level", () => { expect(isLowStock(5, 10)).toBe(true); expect(isLowStock(10, 10)).toBe(true); });
  it("not low when above", () => expect(isLowStock(11, 10)).toBe(false));
  it("reorder level 0 = not tracked", () => expect(isLowStock(0, 0)).toBe(false));
  it("suggestedReorderQty: brings to target", () => expect(suggestedReorderQty(5, 10, 20)).toBe(25)); // target=30, gap=25
});
