import { describe, it, expect } from "vitest";
import { labelForSourceType, validateBands, parseRoleTokens, SOURCE_TYPE_LABEL } from "./bands";

describe("labelForSourceType (GAP-ESTAB-APPROVAL-MATRIX-04)", () => {
  it("maps a known source code to a human label", () => {
    expect(labelForSourceType("finance_sanction")).toBe("Finance: Sanction");
    expect(SOURCE_TYPE_LABEL.hr_leave_special).toBe("HR: Special Leave");
  });
  it("falls back to title case for an unknown code (no raw underscores)", () => {
    expect(labelForSourceType("some_new_action")).toBe("Some New Action");
    expect(labelForSourceType("some_new_action")).not.toMatch(/_/);
  });
});

describe("validateBands (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  const b = (min: number, max: number | null) => ({ minAmountMinor: min, maxAmountMinor: max });

  it("adjacent bands [0,100k) and [100k,500k) are OK (no issues)", () => {
    expect(validateBands([b(0, 100_000)], b(100_000, 500_000))).toEqual([]);
  });

  it("flags overlap for [0,200k) against existing [100k,500k)", () => {
    const issues = validateBands([b(100_000, 500_000)], b(0, 200_000));
    expect(issues.some((i) => i.kind === "overlap")).toBe(true);
  });

  it("warns on a gap for [0,100k) then [200k,∞)", () => {
    const issues = validateBands([b(0, 100_000)], b(200_000, null));
    expect(issues.some((i) => i.kind === "gap")).toBe(true);
    expect(issues.some((i) => i.kind === "overlap")).toBe(false);
  });

  it("open-ended existing band overlaps any higher candidate", () => {
    const issues = validateBands([b(0, null)], b(500_000, 900_000));
    expect(issues.some((i) => i.kind === "overlap")).toBe(true);
  });

  it("no existing bands -> no gap/overlap", () => {
    expect(validateBands([], b(0, 100_000))).toEqual([]);
  });
});

describe("parseRoleTokens (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  it("parses a valid comma list", () => {
    expect(parseRoleTokens("director, cto, ceo")).toEqual(["director", "cto", "ceo"]);
  });
  it("rejects empty", () => {
    expect(parseRoleTokens("   ")).toBeNull();
  });
  it("rejects a token with spaces / uppercase / punctuation", () => {
    expect(parseRoleTokens("Director")).toBeNull();
    expect(parseRoleTokens("dep secretary")).toBeNull();
    expect(parseRoleTokens("ceo!")).toBeNull();
  });
});
