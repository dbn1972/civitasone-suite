import { describe, it, expect } from "vitest";
import { buildProbationMonthsResolver, defaultProbationEnd, LEGACY_PROBATION_MONTHS } from "./probation-period.js";

const canonical = [
  { category: "pay_scale", defaultProbationMonths: 24 },
  { category: "contractual", defaultProbationMonths: 6 },
  { category: "consultant", defaultProbationMonths: 0 },
];

describe("buildProbationMonthsResolver (GAP-HR-CONFIRMATION-05)", () => {
  it("uses the tenant's own employee-type row when it configures a positive period", () => {
    const resolve = buildProbationMonthsResolver([{ code: "STAFF12", category: "other", defaultProbationMonths: 12 }], canonical);
    expect(resolve("STAFF12")).toBe(12);
  });

  it("a tenant-configured period wins over the canonical category it is filed under", () => {
    const resolve = buildProbationMonthsResolver([{ code: "CT9", category: "contractual", defaultProbationMonths: 9 }], canonical);
    expect(resolve("CT9")).toBe(9);
  });

  it("falls back to the canonical category's period when the tenant row configures none (0)", () => {
    const resolve = buildProbationMonthsResolver([{ code: "CT0", category: "contractual", defaultProbationMonths: 0 }], canonical);
    expect(resolve("CT0")).toBe(6);
  });

  it("treats an employeeType that IS a canonical category (no tenant row) as that category", () => {
    const resolve = buildProbationMonthsResolver([], canonical);
    expect(resolve("contractual")).toBe(6);
    expect(resolve("pay_scale")).toBe(24);
  });

  it("keeps the legacy 24 months when nothing is configured: unknown code, legacy 'permanent', or a 0-month category", () => {
    const resolve = buildProbationMonthsResolver([{ code: "OTHER0", category: "other", defaultProbationMonths: 0 }], canonical);
    expect(resolve("permanent")).toBe(LEGACY_PROBATION_MONTHS);
    expect(resolve("never-heard-of-it")).toBe(LEGACY_PROBATION_MONTHS);
    expect(resolve("OTHER0")).toBe(LEGACY_PROBATION_MONTHS);
    expect(resolve("consultant")).toBe(LEGACY_PROBATION_MONTHS);
  });
});

describe("defaultProbationEnd", () => {
  it("is joining + the configured months: a 12-month policy ends a year after joining, not two", () => {
    expect(defaultProbationEnd("2024-01-01", 12)).toBe("2025-01-01");
    expect(defaultProbationEnd("2024-01-01", LEGACY_PROBATION_MONTHS)).toBe("2026-01-01");
  });

  it("is null for a missing or unparseable joining date", () => {
    expect(defaultProbationEnd(null, 12)).toBeNull();
    expect(defaultProbationEnd("garbage", 12)).toBeNull();
  });
});
