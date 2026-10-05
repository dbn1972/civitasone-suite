import { describe, it, expect } from "vitest";
import { formatMoney, formatMoneyIn } from "./formatters";

describe("formatMoneyIn (GAP-CRM-CAMPAIGNS-DETAIL-03)", () => {
  it("formats a USD minor-unit amount with a dollar sign, not rupees", () => {
    const out = formatMoneyIn("12345", "USD");
    expect(out).toContain("$");
    expect(out).toContain("123.45");
    expect(out).not.toContain("₹");
  });

  it("matches formatMoney for INR", () => {
    expect(formatMoneyIn("12345", "INR")).toBe(formatMoney("12345"));
    expect(formatMoneyIn("123456789", "INR")).toBe(formatMoney("123456789"));
  });

  it("uses the currency's own minor-unit exponent (JPY has none)", () => {
    const out = formatMoneyIn("12345", "JPY");
    // 12345 minor units of a 0-decimal currency == 12,345 yen, no decimal part.
    expect(out).toContain("12,345");
    expect(out).not.toContain(".");
  });

  it("signs negative amounts", () => {
    const out = formatMoneyIn("-2550", "USD");
    expect(out.startsWith("-")).toBe(true);
    expect(out).toContain("25.50");
  });

  it("renders missing data as an em dash, never a fabricated zero", () => {
    expect(formatMoneyIn(null, "USD")).toBe("—");
    expect(formatMoneyIn(undefined, "USD")).toBe("—");
    expect(formatMoneyIn("", "USD")).toBe("—");
    expect(formatMoneyIn("garbage", "USD")).toBe("—");
  });

  it("falls back to the INR formatter when no valid currency code is given", () => {
    expect(formatMoneyIn("12345", null)).toBe(formatMoney("12345"));
    expect(formatMoneyIn("12345", "")).toBe(formatMoney("12345"));
    expect(formatMoneyIn("12345", "rupee")).toBe(formatMoney("12345"));
  });
});
