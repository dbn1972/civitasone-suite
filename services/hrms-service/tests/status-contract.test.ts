import { describe, it, expect } from "vitest";
import { EMPLOYEE_STATUSES, EmployeeStatus } from "../src/modules/employee/status.js";

// P1-5: contract test — every canonical employee status value must be lowercase
// with underscores only (no spaces, no capital letters). This test runs in CI
// and will catch any regression if a new value is added with wrong casing.
describe("EmployeeStatus enum contract", () => {
  it("every value is lowercase with underscores only (no spaces, no capital letters)", () => {
    const LOWERCASE_UNDERSCORE = /^[a-z][a-z0-9_]*$/;

    for (const status of EMPLOYEE_STATUSES) {
      // No uppercase letters
      expect(status, `"${status}" must not contain uppercase letters`).toBe(status.toLowerCase());
      // No spaces
      expect(status, `"${status}" must not contain spaces`).not.toContain(" ");
      // Matches the allowed pattern: lowercase letters, digits, underscores
      expect(status, `"${status}" must match /^[a-z][a-z0-9_]*$/`).toMatch(LOWERCASE_UNDERSCORE);
    }
  });

  it("contains at least one value (guard against an accidentally empty enum)", () => {
    expect(EMPLOYEE_STATUSES.length).toBeGreaterThan(0);
  });

  it("has no duplicate values", () => {
    const unique = new Set<string>(EMPLOYEE_STATUSES);
    expect(unique.size).toBe(EMPLOYEE_STATUSES.length);
  });

  // Type-level smoke-check: if EmployeeStatus is a union of literals, this
  // assignment would fail at compile time if any value were removed.
  it("type-level: all 8 canonical values are present", () => {
    const all: EmployeeStatus[] = [
      "probation",
      "confirmed",
      "on_leave",
      "suspended",
      "deputation",
      "retired",
      "separated",
      "terminated",
    ];
    expect(all).toHaveLength(8);
    for (const v of all) {
      expect((EMPLOYEE_STATUSES as readonly string[]).includes(v)).toBe(true);
    }
  });
});
