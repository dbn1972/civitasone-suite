import { describe, it, expect } from "vitest";
import { rupeesToMinorString } from "./money";

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
