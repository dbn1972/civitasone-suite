import { describe, it, expect } from "vitest";
import { formatTenths, parseMinor, tenthsOfPercent } from "./minor";

describe("parseMinor (GAP-PAYROLL-HOME-01: integer paise only)", () => {
  it("reads integer paise from a bigint string, a safe integer number or a bigint", () => {
    expect(parseMinor("9000000")).toBe(9000000n);
    expect(parseMinor("  42 ")).toBe(42n);
    expect(parseMinor("-5")).toBe(-5n);
    expect(parseMinor("+7")).toBe(7n);
    expect(parseMinor(100)).toBe(100n);
    expect(parseMinor(12n)).toBe(12n);
  });

  it("returns null (unknown), never a made-up zero, for anything that is not an integer", () => {
    for (const bad of [null, undefined, "", " ", "12.5", "1e3", "abc", "9000000.00", 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseMinor(bad as never)).toBeNull();
    }
  });
});

describe("tenthsOfPercent / formatTenths (explicit integer rounding, half away from zero)", () => {
  it("20.0% up: 5,00,000.00 -> 6,00,000.00 (paise)", () => {
    expect(tenthsOfPercent(60_000_000n - 50_000_000n, 50_000_000n)).toBe(200n);
    expect(formatTenths(200n)).toBe("20.0");
  });

  it("net-to-gross 91.7%: 5,50,000.00 of 6,00,000.00", () => {
    expect(formatTenths(tenthsOfPercent(55_000_000n, 60_000_000n))).toBe("91.7");
  });

  it("rounds an exact half away from zero, in both directions", () => {
    // 1 / 2000 = 0.05% = 0.5 tenth of a percent
    expect(tenthsOfPercent(1n, 2000n)).toBe(1n);
    expect(tenthsOfPercent(-1n, 2000n)).toBe(-1n);
    // just under a half rounds down
    expect(tenthsOfPercent(1n, 2001n)).toBe(0n);
  });

  it("is exact where a float is not (no 0.1+0.2 style drift)", () => {
    expect(tenthsOfPercent(3n, 10n)).toBe(300n);
    expect(formatTenths(tenthsOfPercent(7n, 100n))).toBe("7.0");
  });

  it("formats a negative change without a sign (the caller shows direction with an arrow)", () => {
    expect(formatTenths(-35n)).toBe("3.5");
    expect(formatTenths(5n)).toBe("0.5");
  });

  it("refuses a non-positive denominator instead of dividing by zero", () => {
    expect(() => tenthsOfPercent(1n, 0n)).toThrow(RangeError);
    expect(() => tenthsOfPercent(1n, -1n)).toThrow(RangeError);
  });
});
