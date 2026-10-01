import { describe, it, expect } from "vitest";
import { rupeesToMinorString, percentToBps } from "./money";

describe("rupeesToMinorString", () => {
  it("converts whole rupees", () => {
    expect(rupeesToMinorString("100")).toBe("10000");
  });

  it("converts a 2-decimal amount exactly", () => {
    expect(rupeesToMinorString("150.50")).toBe("15050");
  });

  it("pads a 1-decimal amount", () => {
    expect(rupeesToMinorString("0.1")).toBe("10");
  });

  it("handles an already-2-decimal amount with a leading zero rupee", () => {
    expect(rupeesToMinorString("0.10")).toBe("10");
  });

  it("converts a large amount without float drift", () => {
    expect(rupeesToMinorString("1234.5")).toBe("123450");
  });

  it("does not mis-round 1.005 the way Math.round(n*100) would (100.49999...->100)", () => {
    // 1.005 has 3 fractional digits — cannot be represented exactly in paise,
    // so it must be rejected outright rather than rounded either way.
    expect(rupeesToMinorString("1.005")).toBeNull();
  });

  it("rejects more than 2 decimal places", () => {
    expect(rupeesToMinorString("12.345")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(rupeesToMinorString("abc")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(rupeesToMinorString("-5")).toBeNull();
  });

  it("rejects zero", () => {
    expect(rupeesToMinorString("0")).toBeNull();
    expect(rupeesToMinorString("0.00")).toBeNull();
  });

  it("rejects empty / whitespace-only input", () => {
    expect(rupeesToMinorString("")).toBeNull();
    expect(rupeesToMinorString("   ")).toBeNull();
  });

  it("rejects thousands separators and other non-plain-decimal formats", () => {
    expect(rupeesToMinorString("1,234.50")).toBeNull();
    expect(rupeesToMinorString("1e5")).toBeNull();
  });
});

describe("percentToBps", () => {
  it("converts whole and fractional percentages to basis points without float drift", () => {
    expect(percentToBps("18")).toBe(1800);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("5.55")).toBe(555);
    expect(percentToBps("0.12")).toBe(12);
  });

  it("allows zero (a 0% rate is valid)", () => {
    expect(percentToBps("0")).toBe(0);
    expect(percentToBps("0.00")).toBe(0);
  });

  it("rejects more than 2 decimal places rather than silently rounding", () => {
    expect(percentToBps("5.555")).toBeNull();
  });

  it("rejects negatives, non-numeric, thousands separators and empty input", () => {
    expect(percentToBps("-1")).toBeNull();
    expect(percentToBps("abc")).toBeNull();
    expect(percentToBps("1,2")).toBeNull();
    expect(percentToBps("")).toBeNull();
    expect(percentToBps("   ")).toBeNull();
  });
});

import { sumRupeesToMinor, applyBpsToMinor } from "./money";

// b3 payroll gap batch (GAP-PAYROLL-CORRECTIONS-03 / OFF-CYCLE-03 / BONUS-02)
describe("rupeesToMinorString — payroll entry cases", () => {
  it("rejects exponent, trailing text and 3 decimals", () => {
    expect(rupeesToMinorString("1e3")).toBeNull();
    expect(rupeesToMinorString("12abc")).toBeNull();
    expect(rupeesToMinorString("1.005")).toBeNull();
  });
  it("converts without float error", () => {
    expect(rupeesToMinorString("1.10")).toBe("110");
    expect(rupeesToMinorString("0.29")).toBe("29");
    expect(rupeesToMinorString("10.5")).toBe("1050");
  });
  it("allowZero admits 0 only when asked", () => {
    expect(rupeesToMinorString("0")).toBeNull();
    expect(rupeesToMinorString("0", { allowZero: true })).toBe("0");
    expect(rupeesToMinorString("0.00", { allowZero: true })).toBe("0");
    expect(rupeesToMinorString("-1", { allowZero: true })).toBeNull();
  });
});

describe("sumRupeesToMinor", () => {
  it("sums exactly in paise (0.1 + 0.2 = 30)", () => {
    expect(sumRupeesToMinor(["0.1", "0.2"])).toBe(30n);
  });
  it("is null if any entry is invalid", () => {
    expect(sumRupeesToMinor(["10", "1.005"])).toBeNull();
    expect(sumRupeesToMinor(["10", ""])).toBeNull();
  });
});

describe("applyBpsToMinor", () => {
  it("matches payroll-service's half-up bonus formula", () => {
    // 21,000.00 basic x 8.33% = 1,749.30
    expect(applyBpsToMinor(2100000n, 833)).toBe(174930n);
    // 1.00 x 8.33% = 0.0833 -> rounds to 8 paise
    expect(applyBpsToMinor(100n, 833)).toBe(8n);
    // 0.06 x 8.33% = 0.4998 paise -> 0; 0.07 -> 0.5831 -> 1
    expect(applyBpsToMinor(6n, 833)).toBe(0n);
    expect(applyBpsToMinor(7n, 833)).toBe(1n);
  });
});
