/**
 * Contractor bill tax engine — GST + §194C TDS (rate by contractor kind,
 * single-bill ₹30k OR annual ₹1L threshold).
 */
import { describe, it, expect } from "vitest";
import { computeContractTax, tds194cRateBps, applyBps } from "../src/modules/contractor-bill/domain.js";

const SINGLE = 3_000_000n;   // ₹30,000
const ANNUAL = 10_000_000n;  // ₹1,00,000

describe("tds194cRateBps", () => {
  it("is 1% for individual/HUF and 2% otherwise", () => {
    expect(tds194cRateBps("individual_huf")).toBe(100);
    expect(tds194cRateBps("other")).toBe(200);
  });
});

describe("computeContractTax", () => {
  it("deducts 2% for a company contractor once the single-bill threshold is crossed", () => {
    // ₹50,000 bill >= ₹30,000 single threshold -> TDS at 2%
    const t = computeContractTax({
      grossMinor: 5_000_000n, gstApplicable: true, gstRateBps: 1800,
      contractorKind: "other", singleThresholdMinor: SINGLE, annualThresholdMinor: ANNUAL, ytdGrossMinor: 0n,
    });
    expect(t.gstMinor).toBe(900_000n);   // 18%
    expect(t.tdsRateBps).toBe(200);
    expect(t.tdsMinor).toBe(100_000n);   // 2% of 50,000 = 1,000
    expect(t.tdsApplied).toBe(true);
    expect(t.netPayableMinor).toBe(5_800_000n); // 50,000 + 9,000 - 1,000 = 58,000
  });

  it("deducts 1% for an individual/HUF contractor", () => {
    const t = computeContractTax({
      grossMinor: 5_000_000n, gstApplicable: false, gstRateBps: 0,
      contractorKind: "individual_huf", singleThresholdMinor: SINGLE, annualThresholdMinor: ANNUAL, ytdGrossMinor: 0n,
    });
    expect(t.tdsRateBps).toBe(100);
    expect(t.tdsMinor).toBe(50_000n);    // 1% of 50,000 = 500
    expect(t.netPayableMinor).toBe(4_950_000n);
  });

  it("does NOT deduct below both thresholds (single < 30k and annual < 1L)", () => {
    // ₹10,000 bill, ₹0 YTD -> single 10k<30k and annual 10k<1L -> no TDS
    const t = computeContractTax({
      grossMinor: 1_000_000n, gstApplicable: false, gstRateBps: 0,
      contractorKind: "other", singleThresholdMinor: SINGLE, annualThresholdMinor: ANNUAL, ytdGrossMinor: 0n,
    });
    expect(t.tdsMinor).toBe(0n);
    expect(t.tdsApplied).toBe(false);
    expect(t.netPayableMinor).toBe(1_000_000n);
  });

  it("crosses via the ANNUAL aggregate even when this single bill is small", () => {
    // this ₹10,000 bill is < 30k single, but YTD ₹95,000 + 10,000 = 1,05,000 >= 1L
    const t = computeContractTax({
      grossMinor: 1_000_000n, gstApplicable: false, gstRateBps: 0,
      contractorKind: "other", singleThresholdMinor: SINGLE, annualThresholdMinor: ANNUAL, ytdGrossMinor: 9_500_000n,
    });
    expect(t.tdsMinor).toBe(20_000n);    // 2% of 10,000 = 200
    expect(t.tdsApplied).toBe(true);
  });
});

describe("applyBps rounding", () => {
  it("rounds half up", () => {
    expect(applyBps(12345n, 200)).toBe(247n);  // 246.9 -> 247
    expect(applyBps(12345n, 100)).toBe(123n);  // 123.45 -> 123
  });
});
