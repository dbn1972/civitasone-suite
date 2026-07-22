/**
 * BoQ domain tests — amount calculation, dimensional measurement,
 * recapitulation with percentages, BoQ freeze rule (BR-015), TS prerequisite (BR-013).
 */
import { describe, it, expect } from "vitest";
import {
  calculateBoqAmount,
  calculateFromDimensions,
  calculateRecapitulation,
  canModifyBoq,
  canEnterBoq,
} from "../src/modules/boq/domain.js";

describe("calculateBoqAmount", () => {
  it("calculates rate × quantity correctly (integer quantity)", () => {
    // rate = 100.00 INR = 10000 paise, quantity = 5
    expect(calculateBoqAmount(10000n, 5)).toBe(50000n);
  });

  it("calculates rate × quantity for decimal quantity", () => {
    // rate = 250.50 INR = 25050 paise, quantity = 2.5
    expect(calculateBoqAmount(25050n, 2.5)).toBe(62625n);
  });

  it("handles very small quantity", () => {
    // rate = 1000 paise, quantity = 0.001
    expect(calculateBoqAmount(1000n, 0.001)).toBe(1n);
  });

  it("handles zero quantity", () => {
    expect(calculateBoqAmount(10000n, 0)).toBe(0n);
  });

  it("handles large amounts (bigint safety)", () => {
    // rate = 1,00,00,000 INR = 1_00_00_000_00 paise, quantity = 1000
    const rate = 1_00_00_000_00n; // 1 crore in paise
    expect(calculateBoqAmount(rate, 1000)).toBe(1_00_00_000_00_000n);
  });

  it("rounds correctly for fractional paise", () => {
    // rate = 333 paise, quantity = 3.3333
    // 333 × 3.3333 = 1109.9889 → scaled: 333 × 33333 / 10000 = 1109
    expect(calculateBoqAmount(333n, 3.3333)).toBe(1109n);
  });
});

describe("calculateFromDimensions", () => {
  it("multiplies N × L × B × D", () => {
    expect(calculateFromDimensions(2, 3, 4, 5)).toBe(120);
  });

  it("treats zero as 1 (missing dimension)", () => {
    expect(calculateFromDimensions(2, 3, 0, 0)).toBe(6); // 2 × 3 × 1 × 1
  });

  it("all zeros becomes 1", () => {
    expect(calculateFromDimensions(0, 0, 0, 0)).toBe(1);
  });

  it("single value with others zero", () => {
    expect(calculateFromDimensions(5, 0, 0, 0)).toBe(5);
  });

  it("handles decimal dimensions", () => {
    expect(calculateFromDimensions(1, 2.5, 3.0, 1)).toBeCloseTo(7.5);
  });
});

describe("calculateRecapitulation", () => {
  it("calculates grand total with all charges", () => {
    const workAmount = 1_000_000n; // 10,000 INR in paise
    const charges = {
      contingencyPercent: 3.0,
      turnoverTaxPercent: 1.0,
      workChargePercent: 2.0,
      qualityControlPercent: 1.0,
      centagePercent: 12.5,
      otherCharges: 5000n,
    };
    const grandTotal = calculateRecapitulation(workAmount, charges);
    // workAmount + 3% + 1% + 2% + 1% + 12.5% + 5000
    // 1_000_000 + 30_000 + 10_000 + 20_000 + 10_000 + 125_000 + 5000
    // = 1_200_000
    expect(grandTotal).toBe(1_200_000n);
  });

  it("handles zero charges", () => {
    const workAmount = 500_000n;
    const charges = {
      contingencyPercent: 0,
      turnoverTaxPercent: 0,
      workChargePercent: 0,
      qualityControlPercent: 0,
      centagePercent: 0,
      otherCharges: 0n,
    };
    expect(calculateRecapitulation(workAmount, charges)).toBe(500_000n);
  });

  it("handles only other charges", () => {
    const workAmount = 100_000n;
    const charges = {
      contingencyPercent: 0,
      turnoverTaxPercent: 0,
      workChargePercent: 0,
      qualityControlPercent: 0,
      centagePercent: 0,
      otherCharges: 25_000n,
    };
    expect(calculateRecapitulation(workAmount, charges)).toBe(125_000n);
  });

  it("handles large work amounts", () => {
    const workAmount = 10_00_00_000_00n; // 10 crore in paise
    const charges = {
      contingencyPercent: 5,
      turnoverTaxPercent: 0,
      workChargePercent: 0,
      qualityControlPercent: 0,
      centagePercent: 0,
      otherCharges: 0n,
    };
    // 10_00_00_000_00 + 5% = 10_00_00_000_00 + 50_00_000_00 = 10_50_00_000_00
    expect(calculateRecapitulation(workAmount, charges)).toBe(10_50_00_000_00n);
  });
});

describe("canModifyBoq (BR-015)", () => {
  it("allows modification when no tender details exist", () => {
    expect(canModifyBoq(false)).toBe(true);
  });

  it("blocks modification when tender details exist", () => {
    expect(canModifyBoq(true)).toBe(false);
  });
});

describe("canEnterBoq (BR-013)", () => {
  it("allows BoQ entry when TS exists", () => {
    expect(canEnterBoq(true)).toBe(true);
  });

  it("blocks BoQ entry when no TS exists", () => {
    expect(canEnterBoq(false)).toBe(false);
  });
});
