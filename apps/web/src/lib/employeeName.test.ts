import { describe, it, expect } from "vitest";
import { employeeDisplayName, employeeInitials } from "./employeeName";

describe("employeeDisplayName (UAT b23 blank-name a11y)", () => {
  it("returns the trimmed name when present", () => {
    expect(employeeDisplayName("  Priya Sharma ", "TE1")).toBe("Priya Sharma");
  });
  it("falls back to a labelled employee number for a blank name", () => {
    expect(employeeDisplayName("", "TE11040650-E07")).toBe("Unnamed employee (TE11040650-E07)");
    expect(employeeDisplayName("   ", "TE11040650-E07")).toBe("Unnamed employee (TE11040650-E07)");
  });
  it("is never empty, even with no name and no number", () => {
    expect(employeeDisplayName(undefined)).toBe("Unnamed employee");
    expect(employeeDisplayName(null, "  ")).toBe("Unnamed employee");
  });
});

describe("employeeInitials", () => {
  it("takes up to two initials", () => {
    expect(employeeInitials("Priya Kumari Sharma")).toBe("PK");
  });
  it("never returns an empty string", () => {
    expect(employeeInitials("")).toBe("?");
    expect(employeeInitials("   ")).toBe("?");
  });
});
