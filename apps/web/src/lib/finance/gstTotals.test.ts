import { describe, it, expect } from "vitest";
import { estimateCashPayable, gstHeadTotals, sumMinor, PERIOD_PATTERN } from "./gstTotals";

describe("sumMinor (GAP-FINANCE-GST-04)", () => {
  it("adds above 2^53 exactly", () => {
    expect(sumMinor(["9007199254740993", "1"])).toBe(9007199254740994n);
  });
  it("returns null when any value is not an integer, instead of counting it as 0", () => {
    expect(sumMinor(["abc"])).toBeNull();
    expect(sumMinor(["10", "12.5"])).toBeNull();
    expect(sumMinor([1.5])).toBeNull();
  });
  it("treats null/undefined as absent and an empty list as 0", () => {
    expect(sumMinor([])).toBe(0n);
    expect(sumMinor([null, undefined, "5", 7])).toBe(12n);
  });
});

describe("gstHeadTotals (GAP-FINANCE-GST-02/03)", () => {
  it("does not net a surplus head against a liability head", () => {
    const t = gstHeadTotals([
      { itc_available: 1000, net_payable: -500 },
      { itc_available: 100, net_payable: 300 },
    ]);
    expect(t).toEqual({ itcAvailable: 1100n, payable: 300n, creditCarriedForward: 500n });
  });
  it("is null when a value is malformed", () => {
    expect(gstHeadTotals([{ itc_available: "x", net_payable: 1 }])).toBeNull();
  });
});

describe("PERIOD_PATTERN (GAP-FINANCE-GST-06)", () => {
  it("accepts months 01-12 only", () => {
    expect(PERIOD_PATTERN.test("2026-07")).toBe(true);
    expect(PERIOD_PATTERN.test("2026-12")).toBe(true);
    expect(PERIOD_PATTERN.test("2026-13")).toBe(false);
    expect(PERIOD_PATTERN.test("2026-00")).toBe(false);
  });
});

describe("estimateCashPayable (statutory set-off order)", () => {
  const r = (gst_type: string, net_payable: number) => ({ gst_type, net_payable });
  it("IGST credit offsets IGST, then CGST, then SGST", () => {
    // IGST surplus 100; CGST due 60, SGST due 70 -> CGST cleared, SGST left 30
    expect(estimateCashPayable([r("IGST", -100), r("CGST", 60), r("SGST", 70)])?.cashPayable).toBe(30n);
  });
  it("CGST credit offsets IGST but never SGST", () => {
    expect(estimateCashPayable([r("CGST", -50), r("SGST", 40), r("IGST", 0)])?.cashPayable).toBe(40n);
    expect(estimateCashPayable([r("CGST", -50), r("IGST", 80)])?.cashPayable).toBe(30n);
  });
  it("SGST credit offsets IGST but never CGST", () => {
    expect(estimateCashPayable([r("SGST", -50), r("CGST", 40)])?.cashPayable).toBe(40n);
    expect(estimateCashPayable([r("SGST", -50), r("IGST", 80)])?.cashPayable).toBe(30n);
  });
  it("CESS is own-head only and uncovered liability stays payable", () => {
    expect(estimateCashPayable([r("IGST", -500), r("CESS", 20)])?.cashPayable).toBe(20n);
  });
  it("is exact above 2^53 and null on malformed input", () => {
    expect(estimateCashPayable([{ gst_type: "CGST", net_payable: "9007199254740993" }])?.cashPayable).toBe(9007199254740993n);
    expect(estimateCashPayable([{ gst_type: "CGST", net_payable: "x" }])).toBeNull();
  });
});
