import { describe, it, expect } from "vitest";
import { paiseToRupeeString, rupeeStringToPaise } from "./formatters";

/**
 * GAP-WORKS-PROPOSALS-DETAIL-03 / GAP-WORKS-PROPOSALS-NEW-02: money is bigint
 * paise end to end. These helpers must round-trip exactly, with no float path
 * that could rewrite ₹86,50,000.50 to ₹86,50,001 on an unedited save.
 */
describe("paiseToRupeeString", () => {
  it("renders a fractional paise value exactly, with two decimals", () => {
    expect(paiseToRupeeString("865000050")).toBe("8650000.50");
  });

  it("round-trips through rupeeStringToPaise with no change (the no-edit case)", () => {
    const stored = "865000050";
    const prefill = paiseToRupeeString(stored);
    expect(prefill).toBe("8650000.50");
    expect(rupeeStringToPaise(prefill!)).toBe(stored);
  });

  it("pads whole rupees to two decimals", () => {
    expect(paiseToRupeeString(100n)).toBe("1.00");
    expect(paiseToRupeeString("50000000")).toBe("500000.00");
  });

  it("returns null for missing data (never a fabricated 0)", () => {
    expect(paiseToRupeeString(null)).toBeNull();
    expect(paiseToRupeeString(undefined)).toBeNull();
    expect(paiseToRupeeString("")).toBeNull();
    expect(paiseToRupeeString("abc")).toBeNull();
  });

  it("preserves exactness well beyond 2^53 paise", () => {
    expect(paiseToRupeeString("9007199254740993")).toBe("90071992547409.93");
  });
});

describe("rupeeStringToPaise", () => {
  it("parses a two-decimal rupee string exactly", () => {
    expect(rupeeStringToPaise("8650000.50")).toBe("865000050");
    expect(rupeeStringToPaise("500000.10")).toBe("50000010");
  });

  it("parses whole rupees", () => {
    expect(rupeeStringToPaise("500000")).toBe("50000000");
  });

  it("parses a single-decimal rupee string", () => {
    expect(rupeeStringToPaise("1.5")).toBe("150");
  });

  it("rejects more than two decimals (no mis-rounding)", () => {
    expect(rupeeStringToPaise("8650000.505")).toBeNull();
    expect(rupeeStringToPaise("1.005")).toBeNull();
  });

  it("rejects non-numeric / empty / malformed input", () => {
    expect(rupeeStringToPaise("")).toBeNull();
    expect(rupeeStringToPaise("  ")).toBeNull();
    expect(rupeeStringToPaise("abc")).toBeNull();
    expect(rupeeStringToPaise(".")).toBeNull();
    expect(rupeeStringToPaise("-5")).toBeNull();
    expect(rupeeStringToPaise("1e3")).toBeNull();
    expect(rupeeStringToPaise(null)).toBeNull();
    expect(rupeeStringToPaise(undefined)).toBeNull();
  });
});
