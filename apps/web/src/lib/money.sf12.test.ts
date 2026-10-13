import { describe, it, expect } from "vitest";
import { minorToRupeesInput, rupeesInputToMinorNumber, rupeesNumberToMinorString } from "./money";
import { formatPaise } from "./formatters";

describe("minorToRupeesInput (SF-12)", () => {
  it("renders exact rupees with 2dp", () => {
    expect(minorToRupeesInput("50000")).toBe("500.00");
    expect(minorToRupeesInput("5")).toBe("0.05");
    expect(minorToRupeesInput("0")).toBe("0.00");
    expect(minorToRupeesInput(123450)).toBe("1234.50");
    expect(minorToRupeesInput(10n ** 18n)).toBe("10000000000000000.00");
  });
  it("returns empty for null, junk, negative or fractional", () => {
    expect(minorToRupeesInput(null)).toBe("");
    expect(minorToRupeesInput(undefined)).toBe("");
    expect(minorToRupeesInput("")).toBe("");
    expect(minorToRupeesInput("12x")).toBe("");
    expect(minorToRupeesInput(-5)).toBe("");
    expect(minorToRupeesInput(1.5)).toBe("");
  });
});

describe("rupeesNumberToMinorString (SF-12)", () => {
  it("converts float rupees without mis-rounding", () => {
    expect(rupeesNumberToMinorString(1234.1)).toBe("123410");
    expect(rupeesNumberToMinorString(0.07)).toBe("7");
    expect(rupeesNumberToMinorString(19.9)).toBe("1990");
    expect(rupeesNumberToMinorString(0)).toBe("0");
    expect(rupeesNumberToMinorString(500)).toBe("50000");
  });
  it("rejects non-finite, negative and huge values", () => {
    expect(rupeesNumberToMinorString(NaN)).toBeNull();
    expect(rupeesNumberToMinorString(-1)).toBeNull();
    expect(rupeesNumberToMinorString(Infinity)).toBeNull();
    expect(rupeesNumberToMinorString(1e21)).toBeNull();
  });
});

describe("rupeesInputToMinorNumber (SF-12)", () => {
  it("parses typed amounts", () => {
    expect(rupeesInputToMinorNumber("500")).toBe(50000);
    expect(rupeesInputToMinorNumber("500.50")).toBe(50050);
    expect(rupeesInputToMinorNumber("500.5")).toBe(50050);
    expect(rupeesInputToMinorNumber(" 12 ")).toBe(1200);
    expect(rupeesInputToMinorNumber("0")).toBe(0);
  });
  it("tolerates mid-typing states", () => {
    expect(rupeesInputToMinorNumber("500.")).toBe(50000);
    expect(rupeesInputToMinorNumber(".5")).toBe(50);
    expect(rupeesInputToMinorNumber("")).toBe(0);
    expect(rupeesInputToMinorNumber(".")).toBe(0);
  });
  it("gives 0 for invalid input rather than rounding", () => {
    expect(rupeesInputToMinorNumber("1.005")).toBe(0);
    expect(rupeesInputToMinorNumber("-5")).toBe(0);
    expect(rupeesInputToMinorNumber("1e3")).toBe(0);
    expect(rupeesInputToMinorNumber("abc")).toBe(0);
    expect(rupeesInputToMinorNumber("99999999999999999")).toBe(0);
  });
});

describe("formatPaise (SF-12, moved from designer sandboxTestModel)", () => {
  it("formats INR via formatMoney", () => {
    expect(formatPaise(50000)).toContain("500");
    expect(formatPaise(0)).toBe("₹0.00");
  });
  it("renders an em-dash for missing amounts, distinct from zero (UX-018)", () => {
    expect(formatPaise(null)).toBe("—");
    expect(formatPaise(undefined)).toBe("—");
    expect(formatPaise(NaN)).toBe("—");
    expect(formatPaise(0)).not.toBe(formatPaise(null));
  });
  it("suffixes other currencies", () => {
    expect(formatPaise(123456, "USD")).toBe("1,234.56 USD");
    expect(formatPaise(null, "USD")).toBe("—");
  });
});
