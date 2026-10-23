import { describe, it, expect } from "vitest";
import { FY_RE, isValidFy } from "./fy";

// GAP-PAYROLL-STATUTORY-PERQUISITE-05: shared Indian financial-year validator.
describe("isValidFy", () => {
  it.each(["2026-27", "2025-26", "2024-25", "1999-00", "2099-00", "2000-01"])("accepts %s", (fy) => {
    expect(isValidFy(fy)).toBe(true);
  });

  it.each([
    ["wrong end year", "2026-28"],
    ["two-digit start", "26-27"],
    ["bare year", "2026"],
    ["four-digit end", "2026-2027"],
    ["end before start", "2026-25"],
    ["same year", "2026-26"],
    ["empty", ""],
    ["leading space", " 2026-27"],
    ["trailing space", "2026-27 "],
    ["trailing newline", "2026-27\n"],
    ["slash separator", "2026/27"],
    ["letters", "abcd-ef"],
    ["wrap year wrong", "2099-01"],
  ])("rejects %s (%s)", (_label, fy) => {
    expect(isValidFy(fy)).toBe(false);
  });

  it("FY_RE alone only checks the shape, isValidFy also checks end = start + 1", () => {
    expect(FY_RE.test("2026-28")).toBe(true);
    expect(isValidFy("2026-28")).toBe(false);
  });
});
