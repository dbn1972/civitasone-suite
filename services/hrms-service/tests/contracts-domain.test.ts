/**
 * HRMS Contracts — state machine, duration, expiry, terms diff tests.
 * Pack #05. Source: modules/contracts/domain.ts
 */
import { describe, it, expect } from "vitest";
import { isValidTransition, assertValidTransition, calculateDurationMonths, canRenew, daysUntilExpiry, detectMilestones, diffTerms, DomainError } from "../src/modules/contracts/domain.js";

describe("contract status transitions", () => {
  it("draft → active", () => expect(isValidTransition("draft", "active")).toBe(true));
  it("active → expiring", () => expect(isValidTransition("active", "expiring")).toBe(true));
  it("active → terminated", () => expect(isValidTransition("active", "terminated")).toBe(true));
  it("expiring → renewed/expired", () => {
    expect(isValidTransition("expiring", "renewed")).toBe(true);
    expect(isValidTransition("expiring", "expired")).toBe(true);
  });
  it("expired is terminal", () => expect(isValidTransition("expired", "active")).toBe(false));
  it("terminated is terminal", () => expect(isValidTransition("terminated", "active")).toBe(false));
  it("assertValidTransition throws DomainError for invalid", () => {
    expect(() => assertValidTransition("expired", "active")).toThrow(DomainError);
  });
});

describe("calculateDurationMonths", () => {
  it("12 months for a full year", () => expect(calculateDurationMonths("2025-04-01", "2026-04-01")).toBe(12));
  it("6 months", () => expect(calculateDurationMonths("2026-01-01", "2026-07-01")).toBe(6));
  it("partial month subtracted when end day < start day", () => {
    expect(calculateDurationMonths("2026-01-31", "2026-02-28")).toBe(0);
  });
});

describe("canRenew — max tenure enforcement", () => {
  it("allowed when within limit", () => {
    const result = canRenew([{ startDate: "2024-01-01", endDate: "2025-01-01" }], "2026-01-01", 36);
    expect(result.allowed).toBe(true);
  });
  it("blocked when exceeds limit", () => {
    const result = canRenew([{ startDate: "2020-01-01", endDate: "2023-01-01" }], "2024-01-01", 36);
    expect(result.allowed).toBe(false);
  });
  it("no limit (null) always allows", () => {
    const result = canRenew([{ startDate: "2000-01-01", endDate: "2020-01-01" }], "2030-01-01", null);
    expect(result.allowed).toBe(true);
  });
});

describe("daysUntilExpiry", () => {
  it("30 days ahead", () => expect(daysUntilExpiry("2026-08-15", "2026-07-15")).toBeCloseTo(31, 0));
  it("already expired (negative)", () => expect(daysUntilExpiry("2026-07-01", "2026-07-15")).toBeLessThan(0));
});

describe("detectMilestones", () => {
  it("detects milestones where days_until_expiry <= milestone", () => {
    // endDate 2026-08-10, asOf 2026-07-15 → ~26 days until expiry
    // milestones [90, 30, 7]: 26 <= 90 ✓, 26 <= 30 ✓, 26 <= 7 ✗
    const result = detectMilestones("2026-08-10", "2026-07-15", [90, 30, 7]);
    expect(result).toContain(90);
    expect(result).toContain(30);
    expect(result).not.toContain(7);
  });
});

describe("diffTerms", () => {
  it("detects changed fields", () => {
    const orig = { role: "Developer", compensationMinor: 50000, currency: "INR", workingHours: 40, deliverables: [], kpis: [], specialConditions: [] };
    const revised = { ...orig, role: "Senior Developer", compensationMinor: 60000 };
    const diff = diffTerms(orig as any, revised as any);
    expect(diff.changedFields).toContain("role");
    expect(diff.changedFields).toContain("compensationMinor");
    expect(diff.changedFields).not.toContain("currency");
  });
  it("empty diff when identical", () => {
    const terms = { role: "X", compensationMinor: 1, currency: "INR", workingHours: 8, deliverables: [], kpis: [], specialConditions: [] };
    expect(diffTerms(terms as any, terms as any).changedFields).toEqual([]);
  });
});
