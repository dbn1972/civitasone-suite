import { describe, it, expect } from "vitest";
import { formatMoney, formatIndianDate } from "./formatters";

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

  it("returns INR 0.00 for invalid input", () => {
    expect(formatMoney("not-a-number")).toBe("\u20b90.00");
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
