/**
 * CRM Commissions — commission calculation and period derivation tests.
 * Pack #06. Source: modules/commissions/domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeCommission, derivePeriod } from "../src/modules/commissions/domain.js";

describe("computeCommission", () => {
  describe("fixed rate", () => {
    it("returns fixed rateValue regardless of deal size", () => {
      expect(computeCommission(1_000_000n, { rateType: "fixed", rateValue: 50_000n })).toBe(50_000n);
      expect(computeCommission(999_999_999n, { rateType: "fixed", rateValue: 50_000n })).toBe(50_000n);
    });

    it("zero fixed rate = zero commission", () => {
      expect(computeCommission(1_000_000n, { rateType: "fixed", rateValue: 0n })).toBe(0n);
    });
  });

  describe("percentage rate (basis points)", () => {
    it("500 bps = 5% commission", () => {
      // 1,000,000 paise * 500 / 10000 = 50,000 paise
      expect(computeCommission(1_000_000n, { rateType: "percentage", rateValue: 500n })).toBe(50_000n);
    });

    it("1000 bps = 10%", () => {
      expect(computeCommission(200_000n, { rateType: "percentage", rateValue: 1000n })).toBe(20_000n);
    });

    it("100 bps = 1%", () => {
      expect(computeCommission(1_000_000n, { rateType: "percentage", rateValue: 100n })).toBe(10_000n);
    });

    it("handles large deal values (above 2^53) in bigint", () => {
      const bigDeal = 10_000_000_000_000n; // Rs 1000 crore
      const commission = computeCommission(bigDeal, { rateType: "percentage", rateValue: 250n });
      expect(commission).toBe(250_000_000_000n); // 2.5% of Rs 1000 crore
    });

    it("integer division truncates (floor)", () => {
      // 333 * 500 / 10000 = 16 (truncated from 16.65)
      expect(computeCommission(333n, { rateType: "percentage", rateValue: 500n })).toBe(16n);
    });
  });
});

describe("derivePeriod", () => {
  it("returns YYYY-MM format", () => {
    expect(derivePeriod(new Date("2026-07-15"))).toBe("2026-07");
  });

  it("pads single-digit month", () => {
    expect(derivePeriod(new Date("2026-01-01"))).toBe("2026-01");
  });

  it("December", () => {
    expect(derivePeriod(new Date("2025-12-31"))).toBe("2025-12");
  });
});
