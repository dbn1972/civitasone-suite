import { describe, it, expect } from "vitest";
import { rupeesToMinorString } from "./money";

describe("rupeesToMinorString", () => {
  it("converts whole rupees to paise", () => {
    expect(rupeesToMinorString("1200")).toBe("120000");
  });

  it("converts a single decimal digit (implicit trailing zero)", () => {
    expect(rupeesToMinorString("1200.5")).toBe("120050");
  });

  it("converts two decimal digits", () => {
    expect(rupeesToMinorString("1200.50")).toBe("120050");
  });

  it("handles trailing-zero amounts", () => {
    expect(rupeesToMinorString("10.50")).toBe("1050");
    expect(rupeesToMinorString("5.00")).toBe("500");
  });

  it("handles a leading-zero rupee amount", () => {
    expect(rupeesToMinorString("0.10")).toBe("10");
    expect(rupeesToMinorString("0.5")).toBe("50");
  });

  it("strips redundant leading zeros in the whole part", () => {
    expect(rupeesToMinorString("007.50")).toBe("750");
    expect(rupeesToMinorString("00100")).toBe("10000");
  });

  it("rejects more than 2 decimal places instead of rounding (the float bug)", () => {
    // Math.round(1.005 * 100) === 100 in IEEE-754 (should be 101) — this
    // function must never silently mis-round; it rejects the ambiguous
    // 3rd decimal digit outright rather than guessing.
    expect(rupeesToMinorString("1.005")).toBeNull();
    expect(rupeesToMinorString("100.999")).toBeNull();
  });

  it("has no floating-point drift across additions (0.1 + 0.2 style)", () => {
    const a = rupeesToMinorString("0.10");
    const b = rupeesToMinorString("0.20");
    expect(a).toBe("10");
    expect(b).toBe("20");
    expect(BigInt(a!) + BigInt(b!)).toBe(BigInt(rupeesToMinorString("0.30")!));
  });

  it("rejects zero amounts", () => {
    expect(rupeesToMinorString("0")).toBeNull();
    expect(rupeesToMinorString("0.00")).toBeNull();
    expect(rupeesToMinorString("0.0")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(rupeesToMinorString("-5")).toBeNull();
    expect(rupeesToMinorString("-5.50")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(rupeesToMinorString("abc")).toBeNull();
    expect(rupeesToMinorString("12,000")).toBeNull();
    expect(rupeesToMinorString("1e5")).toBeNull();
    expect(rupeesToMinorString("")).toBeNull();
    expect(rupeesToMinorString("   ")).toBeNull();
    expect(rupeesToMinorString("12.")).toBeNull();
    expect(rupeesToMinorString(".50")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(rupeesToMinorString("  250.75  ")).toBe("25075");
  });

  it("converts a large amount without precision loss", () => {
    expect(rupeesToMinorString("99999999999.99")).toBe("9999999999999");
  });
});
