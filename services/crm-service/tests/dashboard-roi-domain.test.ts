/**
 * CRM Dashboard — campaign ROI domain tests.
 * Pack #10. Source: modules/dashboard/roi-domain.ts
 */
import { describe, it, expect } from "vitest";
import { computeRoi, computeNetMinor, costPerResponse, formatBasisPoints, ROI_UNDEFINED, BPS_SCALE } from "../src/modules/dashboard/roi-domain.js";

describe("computeRoi — basis points, bigint", () => {
  it("100% ROI = 10000 bps", () => {
    expect(computeRoi(100_000n, 200_000n)).toBe(10_000n); // (200k-100k)/100k * 10000
  });
  it("0% ROI (break-even)", () => expect(computeRoi(100_000n, 100_000n)).toBe(0n));
  it("negative ROI (loss)", () => expect(computeRoi(100_000n, 50_000n)).toBe(-5_000n)); // -50%
  it("zero cost → undefined (not infinity)", () => expect(computeRoi(0n, 100_000n)).toBe(ROI_UNDEFINED));
  it("large amounts stay exact (bigint)", () => {
    const roi = computeRoi(10_000_000_000n, 15_000_000_000n);
    expect(roi).toBe(5_000n); // 50%
  });
  it("integer division truncates (conservative)", () => {
    // cost=3, revenue=4 → profit=1, ROI = 1/3*10000 = 3333 (truncated from 3333.33)
    expect(computeRoi(3n, 4n)).toBe(3333n);
  });
});

describe("computeNetMinor", () => {
  it("profit when revenue > cost", () => expect(computeNetMinor(100_000n, 150_000n)).toBe(50_000n));
  it("loss when cost > revenue", () => expect(computeNetMinor(200_000n, 100_000n)).toBe(-100_000n));
  it("zero when equal", () => expect(computeNetMinor(100n, 100n)).toBe(0n));
});

describe("costPerResponse", () => {
  it("divides cost by responses", () => expect(costPerResponse(100_000n, 50)).toBe(2_000n));
  it("returns null for 0 responses", () => expect(costPerResponse(100_000n, 0)).toBeNull());
  it("returns null for negative responses", () => expect(costPerResponse(100_000n, -1)).toBeNull());
  it("integer division truncates", () => expect(costPerResponse(100n, 3)).toBe(33n));
});

describe("formatBasisPoints", () => {
  it("10000 → '100.00'", () => expect(formatBasisPoints(10_000n)).toBe("100.00"));
  it("-5000 → '-50.00'", () => expect(formatBasisPoints(-5_000n)).toBe("-50.00"));
  it("3333 → '33.33'", () => expect(formatBasisPoints(3_333n)).toBe("33.33"));
  it("null → null", () => expect(formatBasisPoints(ROI_UNDEFINED)).toBeNull());
  it("0 → '0.00'", () => expect(formatBasisPoints(0n)).toBe("0.00"));
});
