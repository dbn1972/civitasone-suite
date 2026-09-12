import { describe, it, expect } from "vitest";
import { formatMoney, formatIndianDate, minorToRupeesOrNull } from "./formatters";

// ---------------------------------------------------------------------------
// formatMoney -- converts minor units (paise) to INR string with Indian grouping
// ---------------------------------------------------------------------------
describe("formatMoney", () => {
  it("formats paise as rupees with 2 decimal places", () => {
    expect(formatMoney(100)).toBe("\u20b91.00");
  });

  it("applies Indian lakh/crore grouping", () => {
    // 123456789 paise = INR 12,34,567.89
    expect(formatMoney(123456789n)).toBe("\u20b912,34,567.89");
  });

  it("handles zero", () => {
    expect(formatMoney(0)).toBe("\u20b90.00");
  });

  it("handles negative minor units", () => {
    expect(formatMoney(-2550)).toBe("-\u20b925.50");
  });

  it("accepts bigint input", () => {
    expect(formatMoney(100n)).toBe("\u20b91.00");
  });

  it("accepts numeric string input", () => {
    expect(formatMoney("2550")).toBe("\u20b925.50");
  });

  it("accepts negative numeric string", () => {
    expect(formatMoney("-2550")).toBe("-\u20b925.50");
  });

  it("returns an em-dash for invalid input, never a fabricated \u20b90.00 (UX-006)", () => {
    expect(formatMoney("not-a-number")).toBe("\u2014");
  });

  // ---------------------------------------------------------------------------
  // UX-006: missing money must render as an honest "\u2014", never as \u20b90.00 --
  // a real zero amount and a missing/error value must stay visually distinct.
  // ---------------------------------------------------------------------------
  it("returns an em-dash for null (UX-006: missing, not zero)", () => {
    expect(formatMoney(null)).toBe("\u2014");
  });

  it("returns an em-dash for undefined (UX-006: missing, not zero)", () => {
    expect(formatMoney(undefined)).toBe("\u2014");
  });

  it("returns an em-dash for an empty string (UX-006: missing, not zero)", () => {
    expect(formatMoney("")).toBe("\u2014");
  });

  it("returns an em-dash for non-finite numeric input (UX-006: missing, not zero)", () => {
    expect(formatMoney(Number.NaN)).toBe("\u2014");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("\u2014");
  });

  it("keeps a genuine zero amount as \u20b90.00, distinct from missing data", () => {
    expect(formatMoney(0)).toBe("\u20b90.00");
    expect(formatMoney(0)).not.toBe(formatMoney(null));
    expect(formatMoney(0)).not.toBe(formatMoney(undefined));
  });

  it("pads single-digit paise with leading zero", () => {
    // 101 paise = INR 1.01
    expect(formatMoney(101)).toBe("\u20b91.01");
  });

  it("formats large amount in crore range", () => {
    // 1000000000 paise = INR 1,00,00,000.00
    expect(formatMoney(1000000000n)).toBe("\u20b91,00,00,000.00");
  });
});

// ---------------------------------------------------------------------------
// formatIndianDate -- formats ISO dates as dd/MM/yyyy per GFR 2017
// ---------------------------------------------------------------------------
describe("formatIndianDate", () => {
  it("formats ISO date string in Indian locale", () => {
    const result = formatIndianDate("2024-01-15");
    expect(result).toMatch(/15[/]01[/]2024/);
  });

  it("returns em-dash for null", () => {
    expect(formatIndianDate(null)).toBe("\u2014");
  });

  it("returns em-dash for undefined", () => {
    expect(formatIndianDate(undefined)).toBe("\u2014");
  });

  it("returns em-dash for empty string", () => {
    expect(formatIndianDate("")).toBe("\u2014");
  });

  it("returns original string for unparseable date", () => {
    const bad = "not-a-date";
    expect(formatIndianDate(bad)).toBe(bad);
  });

  it("formats Republic Day correctly", () => {
    const result = formatIndianDate("2024-01-26");
    expect(result).toMatch(/26[/]01[/]2024/);
  });

  it("formats fiscal year end correctly", () => {
    const result = formatIndianDate("2024-03-31");
    expect(result).toMatch(/31[/]03[/]2024/);
  });
});

import { formatRupees } from "./formatters";
describe("formatRupees (input already in rupees)", () => {
  it("formats a rupee value without dividing by 100", () => {
    expect(formatRupees(90000)).toBe("₹90,000.00");
    expect(formatRupees(90000)).not.toBe("₹900.00");
  });
  it("handles string input safely", () => {
    expect(formatRupees("1234.5")).toBe("₹1,234.50");
  });

  it("returns an em-dash for non-finite/missing input, never a fabricated ₹0.00 (UX-006)", () => {
    expect(formatRupees(Number.NaN)).toBe("—");
    expect(formatRupees(null)).toBe("—");
    expect(formatRupees(undefined)).toBe("—");
    expect(formatRupees("")).toBe("—");
  });

  it("keeps a genuine zero amount as ₹0.00, distinct from missing data", () => {
    expect(formatRupees(0)).toBe("₹0.00");
    expect(formatRupees(0)).not.toBe(formatRupees(null));
  });
});

describe("minorToRupeesOrNull (UX-006 type guard for arithmetic on *Minor fields)", () => {
  it("converts minor units to a rupee number", () => {
    expect(minorToRupeesOrNull(12345)).toBeCloseTo(123.45);
    expect(minorToRupeesOrNull("90000")).toBeCloseTo(900);
    expect(minorToRupeesOrNull(100n)).toBeCloseTo(1);
  });

  it("returns null for missing/invalid input instead of a fabricated 0", () => {
    expect(minorToRupeesOrNull(null)).toBeNull();
    expect(minorToRupeesOrNull(undefined)).toBeNull();
    expect(minorToRupeesOrNull("")).toBeNull();
    expect(minorToRupeesOrNull("garbage")).toBeNull();
    expect(minorToRupeesOrNull(Number.NaN)).toBeNull();
  });

  it("distinguishes a genuine zero from missing data", () => {
    expect(minorToRupeesOrNull(0)).toBe(0);
    expect(minorToRupeesOrNull(0)).not.toBeNull();
  });
});

import { formatBps } from "./formatters";
describe("formatBps (basis points -> percent, no premature rounding)", () => {
  it("strips trailing zeros", () => {
    expect(formatBps(1200)).toBe("12%");
    expect(formatBps(10000)).toBe("100%");
  });
  it("keeps a meaningful fraction", () => {
    expect(formatBps(550)).toBe("5.5%");
    expect(formatBps(12)).toBe("0.12%");
    expect(formatBps(1)).toBe("0.01%");
  });
  it("accepts numeric strings", () => {
    expect(formatBps("1200")).toBe("12%");
  });
  it("returns an em-dash for null/undefined/invalid", () => {
    expect(formatBps(null)).toBe("—");
    expect(formatBps(undefined)).toBe("—");
    expect(formatBps("abc")).toBe("—");
  });
});
