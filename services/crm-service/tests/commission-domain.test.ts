/**
 * Gap 1 — Commission domain logic tests.
 */
import { describe, it, expect } from "vitest";
import { computeCommission, derivePeriod } from "../src/modules/commissions/domain.js";

describe("computeCommission", () => {
  it("computes percentage-based commission (5% = 500 basis points)", () => {
    const result = computeCommission(1_000_000n, { rateType: "percentage", rateValue: 500n });
    // 1,000,000 * 500 / 10000 = 50,000
    expect(result).toBe(50_000n);
  });

  it("computes fixed commission", () => {
    const result = computeCommission(1_000_000n, { rateType: "fixed", rateValue: 25_000n });
    expect(result).toBe(25_000n);
  });

  it("handles zero deal value for percentage", () => {
    const result = computeCommission(0n, { rateType: "percentage", rateValue: 500n });
    expect(result).toBe(0n);
  });

  it("handles zero rate", () => {
    const result = computeCommission(1_000_000n, { rateType: "percentage", rateValue: 0n });
    expect(result).toBe(0n);
  });

  it("handles large deal values without overflow", () => {
    const largeValue = 10_000_000_000n; // 100 crore paise = 10 crore INR
    const result = computeCommission(largeValue, { rateType: "percentage", rateValue: 250n });
    // 10B * 250 / 10000 = 250,000,000 (2.5 crore paise = 25 lakh INR)
    expect(result).toBe(250_000_000n);
  });
});

describe("derivePeriod", () => {
  it("returns YYYY-MM format", () => {
    expect(derivePeriod(new Date("2025-07-15"))).toBe("2025-07");
  });

  it("pads single-digit months", () => {
    expect(derivePeriod(new Date("2025-01-01"))).toBe("2025-01");
  });

  it("handles December", () => {
    expect(derivePeriod(new Date("2025-12-31"))).toBe("2025-12");
  });
});
