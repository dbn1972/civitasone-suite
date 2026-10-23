import { describe, it, expect } from "vitest";
import {
  legacyRupeesToMinor,
  minorOrLegacy,
  runMinor,
  formatRunMoney,
  formatMinorString,
  formatMinorOrLegacy,
  parseMinorString,
  percentOneDecimal,
} from "./runMoney";

// GAP-PAYROLL-RUNS-01 acceptance: the adapter maps {grossMinor:'9000000'} and the
// legacy {grossAmount:90000} to the SAME formatMoney string.
describe("run money adapter — exact paise first, legacy rupee float only as fallback", () => {
  it("maps {grossMinor:'9000000'} and legacy {grossAmount:90000} to the same string", () => {
    expect(formatRunMoney({ grossMinor: "9000000" }, "gross")).toBe("₹90,000.00");
    expect(formatRunMoney({ grossAmount: 90000 }, "gross")).toBe("₹90,000.00");
    expect(formatRunMoney({ grossMinor: "9000000" }, "gross")).toBe(formatRunMoney({ grossAmount: 90000 }, "gross"));
  });

  it("renders a net of 1,23,456.78 identically from the paise string and from the legacy float", () => {
    // 123456.78 is not exactly representable as a double; the legacy path must still land on 12345678 paise.
    expect(formatRunMoney({ netMinor: "12345678" }, "net")).toBe("₹1,23,456.78");
    expect(formatRunMoney({ netAmount: 123456.78 }, "net")).toBe("₹1,23,456.78");
    expect(runMinor({ netAmount: 123456.78 }, "net")).toBe(12345678n);
  });

  it("prefers the exact paise string when both are present, even if the float disagrees", () => {
    expect(runMinor({ grossMinor: "9000001", grossAmount: 90000 }, "gross")).toBe(9000001n);
    expect(formatRunMoney({ grossMinor: "9000001", grossAmount: 90000 }, "gross")).toBe("₹90,000.01");
  });

  it("is bigint-safe above 2^53 paise (no float round trip)", () => {
    // 9_007_199_254_740_993 paise is 2^53 + 1: a JS number cannot hold it.
    expect(runMinor({ grossMinor: "9007199254740993" }, "gross")).toBe(9007199254740993n);
    expect(formatRunMoney({ grossMinor: "9007199254740993" }, "gross")).toBe("₹9,00,71,99,25,47,409.93");
  });

  it("reads deductions from deductionsMinor / deductions", () => {
    expect(formatRunMoney({ deductionsMinor: "1000000" }, "deductions")).toBe("₹10,000.00");
    expect(formatRunMoney({ deductions: 10000 }, "deductions")).toBe("₹10,000.00");
  });

  it("a malformed paise string (non-integer money) is never trusted: it falls back, then dashes", () => {
    // contract guard: '12.5' / '1e3' / '' are not integer paise.
    expect(minorOrLegacy("12.5", 100)).toBe(10000n);
    expect(minorOrLegacy("1e3", 100)).toBe(10000n);
    expect(minorOrLegacy("", null)).toBeNull();
    expect(formatRunMoney({ grossMinor: "12.5" }, "gross")).toBe("—");
  });

  it("missing figures render a dash, never a fabricated zero (UX-006)", () => {
    expect(formatRunMoney({}, "net")).toBe("—");
    expect(formatRunMoney({ netAmount: null, netMinor: null }, "net")).toBe("—");
    expect(formatRunMoney({ netAmount: Number.NaN }, "net")).toBe("—");
    expect(formatMinorString(null)).toBe("—");
    expect(formatMinorString(undefined)).toBe("—");
    // a genuine zero is a zero
    expect(formatRunMoney({ netMinor: "0" }, "net")).toBe("₹0.00");
    expect(formatRunMoney({ netAmount: 0 }, "net")).toBe("₹0.00");
  });

  it("converts legacy rupee floats by decimal string, exactly, for awkward paise", () => {
    // 0.1 + 0.2 style values and classic x.xx5 doubles
    expect(legacyRupeesToMinor(0.3)).toBe(30n);
    expect(legacyRupeesToMinor(1234.56)).toBe(123456n);
    expect(legacyRupeesToMinor(1.1)).toBe(110n);
    expect(legacyRupeesToMinor(0.07)).toBe(7n);
    expect(legacyRupeesToMinor(-25.5)).toBe(-2550n);
    expect(legacyRupeesToMinor(-0)).toBe(0n);
    expect(legacyRupeesToMinor(1e21)).toBeNull();
    expect(legacyRupeesToMinor(Number.POSITIVE_INFINITY)).toBeNull();
    expect(legacyRupeesToMinor(undefined)).toBeNull();
  });

  it("every paise value up to 5 lakh rupees round-trips through the legacy float exactly", () => {
    // The backend sends rupees as Number(paise) / 100; the adapter must invert that for every paise value.
    for (let paise = 0; paise <= 50_000_000; paise += 7919) {
      expect(legacyRupeesToMinor(paise / 100)).toBe(BigInt(paise));
    }
    // and the awkward tail end
    for (const paise of [1, 5, 99, 101, 12345678, 99999999, 123456789012]) {
      expect(legacyRupeesToMinor(paise / 100)).toBe(BigInt(paise));
    }
  });

  it("formatMinorOrLegacy serves the per-slip pairs (paise string preferred)", () => {
    expect(formatMinorOrLegacy("68000", 999)).toBe("₹680.00");
    expect(formatMinorOrLegacy(undefined, 680)).toBe("₹680.00");
    expect(formatMinorOrLegacy(undefined, undefined)).toBe("—");
  });

  it("parseMinorString accepts only integer digit strings", () => {
    expect(parseMinorString("0")).toBe(0n);
    expect(parseMinorString("-500")).toBe(-500n);
    expect(parseMinorString("5.0")).toBeNull();
    expect(parseMinorString(" 5")).toBeNull();
    expect(parseMinorString(null)).toBeNull();
  });
});

describe("percentOneDecimal — BigInt ratio, one decimal, rounded half-up", () => {
  it("computes exact ratios", () => {
    expect(percentOneDecimal(10_000_000n, 50_000_000n)).toBe("20.0");
    expect(percentOneDecimal(55_000_000n, 60_000_000n)).toBe("91.7"); // 91.666...
    expect(percentOneDecimal(1n, 3n)).toBe("33.3");
  });

  it("rounds a tie half-up (6.25 -> 6.3, 62.5 stays 62.5) and uses the magnitude of a negative delta", () => {
    expect(percentOneDecimal(1n, 16n)).toBe("6.3");
    expect(percentOneDecimal(5n, 8n)).toBe("62.5");
    expect(percentOneDecimal(-1n, 16n)).toBe("6.3");
  });

  it("is null against a zero or negative base", () => {
    expect(percentOneDecimal(5n, 0n)).toBeNull();
    expect(percentOneDecimal(5n, -1n)).toBeNull();
  });

  it("stays exact for amounts a float ratio would blur", () => {
    // 9_007_199_254_740_993 / 9_007_199_254_740_992 is > 100.0% by 1 part in 9e15 -> still "100.0"
    expect(percentOneDecimal(9_007_199_254_740_993n, 9_007_199_254_740_992n)).toBe("100.0");
  });
});
