/**
 * TASK 1 — Employee status contract test (P1-5)
 *
 * Verifies:
 *  - All 9 canonical statuses are lowercase
 *  - isEmployeeStatus() type-guard behaviour
 *  - SERVING_STATUSES exact membership
 *  - Zod enum parsing — valid vs. invalid values
 *  - "active" (legacy, pre-migration-0025) is rejected at the Zod layer
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  EMPLOYEE_STATUSES,
  employeeStatusEnum,
  isEmployeeStatus,
  SERVING_STATUSES,
  type EmployeeStatus,
} from "./status.js";

// ---------------------------------------------------------------------------
describe("EMPLOYEE_STATUSES — canonical set", () => {
  const EXPECTED = [
    "probation",
    "confirmed",
    "on_leave",
    "suspended",
    "deputation",
    "retired",
    "separated",
    "terminated",
    "no_show",
  ] as const;

  it("contains exactly 9 statuses", () => {
    expect(EMPLOYEE_STATUSES).toHaveLength(9);
  });

  it("every status is lowercase (no uppercase, no spaces)", () => {
    for (const s of EMPLOYEE_STATUSES) {
      expect(s).toBe(s.toLowerCase());          // no uppercase
      expect(s).not.toMatch(/\s/);              // no whitespace
    }
  });

  it("contains all 9 expected values in the documented order", () => {
    expect([...EMPLOYEE_STATUSES]).toEqual([...EXPECTED]);
  });
});

// ---------------------------------------------------------------------------
describe("isEmployeeStatus() — type-guard", () => {
  it("returns true for all 9 canonical statuses", () => {
    const valid: string[] = [
      "probation", "confirmed", "on_leave", "suspended",
      "deputation", "retired", "separated", "terminated", "no_show",
    ];
    for (const s of valid) {
      expect(isEmployeeStatus(s), `expected true for "${s}"`).toBe(true);
    }
  });

  it('returns false for "Active" (Title-case legacy value)', () => {
    expect(isEmployeeStatus("Active")).toBe(false);
  });

  it('returns false for "CONFIRMED" (all-caps)', () => {
    expect(isEmployeeStatus("CONFIRMED")).toBe(false);
  });

  it('returns false for "active" (lowercase legacy alias — DB migration 0025 removed this)', () => {
    expect(isEmployeeStatus("active")).toBe(false);
  });

  it('returns false for "on leave" (space instead of underscore)', () => {
    expect(isEmployeeStatus("on leave")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEmployeeStatus("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("SERVING_STATUSES — active-headcount set", () => {
  it("contains exactly 3 entries", () => {
    expect(SERVING_STATUSES.size).toBe(3);
  });

  it('contains "probation"', () => {
    expect(SERVING_STATUSES.has("probation")).toBe(true);
  });

  it('contains "confirmed"', () => {
    expect(SERVING_STATUSES.has("confirmed")).toBe(true);
  });

  it('contains "deputation"', () => {
    expect(SERVING_STATUSES.has("deputation")).toBe(true);
  });

  it('does NOT contain "on_leave"', () => {
    // on_leave is NOT a serving status — the employee is absent
    expect(SERVING_STATUSES.has("on_leave" as EmployeeStatus)).toBe(false);
  });

  it('does NOT contain "suspended"', () => {
    expect(SERVING_STATUSES.has("suspended" as EmployeeStatus)).toBe(false);
  });

  it('does NOT contain "retired"', () => {
    expect(SERVING_STATUSES.has("retired" as EmployeeStatus)).toBe(false);
  });

  it('does NOT contain "separated"', () => {
    expect(SERVING_STATUSES.has("separated" as EmployeeStatus)).toBe(false);
  });

  it('does NOT contain "terminated"', () => {
    expect(SERVING_STATUSES.has("terminated" as EmployeeStatus)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("employeeStatusEnum (Zod) — parse contract", () => {
  it('parses "probation" successfully', () => {
    expect(employeeStatusEnum.parse("probation")).toBe("probation");
  });

  it("parses all 9 canonical values without throwing", () => {
    const valid = [
      "probation", "confirmed", "on_leave", "suspended",
      "deputation", "retired", "separated", "terminated", "no_show",
    ];
    for (const v of valid) {
      expect(() => employeeStatusEnum.parse(v)).not.toThrow();
    }
  });

  it('throws ZodError for "Active" (Title-case)', () => {
    expect(() => employeeStatusEnum.parse("Active")).toThrow(z.ZodError);
  });

  it('throws ZodError for "CONFIRMED" (uppercase)', () => {
    expect(() => employeeStatusEnum.parse("CONFIRMED")).toThrow(z.ZodError);
  });

  it('throws ZodError for "active" — legacy pre-0025 value, must be rejected', () => {
    // Migration 0025 normalised all DB values; any code that re-inserts "active"
    // is a regression. The Zod layer must reject it.
    expect(() => employeeStatusEnum.parse("active")).toThrow(z.ZodError);
  });

  it('throws ZodError for "on leave" (space variant)', () => {
    expect(() => employeeStatusEnum.parse("on leave")).toThrow(z.ZodError);
  });

  it('throws ZodError for an empty string', () => {
    expect(() => employeeStatusEnum.parse("")).toThrow(z.ZodError);
  });
});
