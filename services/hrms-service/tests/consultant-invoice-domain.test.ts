/**
 * Consultant invoice tax engine — GST + Section-194J TDS, FY-threshold gating.
 */
import { describe, it, expect } from "vitest";
import { computeInvoiceTax, applyBps } from "../src/modules/consultant-invoice/domain.js";

const THRESH = 3_000_000n; // ₹30,000

describe("applyBps", () => {
  it("rounds half up and floors non-positive inputs", () => {
    expect(applyBps(100000n, 1000)).toBe(10000n);     // 10% of ₹1000 = ₹100
    expect(applyBps(12345n, 1800)).toBe(2222n);        // 18% of 12345 = 2222.1 -> 2222
    expect(applyBps(12347n, 1800)).toBe(2222n);        // 2222.46 -> 2222
    expect(applyBps(0n, 1800)).toBe(0n);
    expect(applyBps(100000n, 0)).toBe(0n);
  });
});

describe("computeInvoiceTax", () => {
  it("applies 194J TDS + 18% GST once the FY threshold is crossed", () => {
    // gross ₹50,000 = 5,000,000 paise, no prior YTD, threshold already crossed by this one
    const t = computeInvoiceTax({
      grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: THRESH, ytdGrossMinor: 0n,
    });
    expect(t.gstMinor).toBe(900_000n);        // 18% of 50,000 = 9,000
    expect(t.tdsMinor).toBe(500_000n);        // 10% of 50,000 = 5,000
    expect(t.tdsApplied).toBe(true);
    expect(t.netPayableMinor).toBe(5_400_000n); // 50,000 + 9,000 - 5,000 = 54,000
  });

  it("does NOT deduct TDS below the ₹30,000 FY aggregate threshold", () => {
    // gross ₹10,000, no prior YTD -> aggregate 10,000 < 30,000 -> no TDS
    const t = computeInvoiceTax({
      grossMinor: 1_000_000n, gstApplicable: false, gstRateBps: 0,
      tdsRateBps: 1000, tdsThresholdMinor: THRESH, ytdGrossMinor: 0n,
    });
    expect(t.tdsMinor).toBe(0n);
    expect(t.tdsApplied).toBe(false);
    expect(t.netPayableMinor).toBe(1_000_000n);
  });

  it("crosses the threshold using prior YTD and then deducts TDS on this invoice", () => {
    // prior YTD ₹25,000 + this ₹10,000 = ₹35,000 >= 30,000 -> TDS on this ₹10,000
    const t = computeInvoiceTax({
      grossMinor: 1_000_000n, gstApplicable: false, gstRateBps: 0,
      tdsRateBps: 1000, tdsThresholdMinor: THRESH, ytdGrossMinor: 2_500_000n,
    });
    expect(t.tdsMinor).toBe(100_000n);   // 10% of 10,000 = 1,000
    expect(t.tdsApplied).toBe(true);
    expect(t.netPayableMinor).toBe(900_000n);
  });

  it("no GST when not applicable, regardless of rate", () => {
    const t = computeInvoiceTax({
      grossMinor: 5_000_000n, gstApplicable: false, gstRateBps: 1800,
      tdsRateBps: 1000, tdsThresholdMinor: THRESH, ytdGrossMinor: 0n,
    });
    expect(t.gstMinor).toBe(0n);
    expect(t.netPayableMinor).toBe(4_500_000n); // 50,000 - 5,000 TDS
  });
});
