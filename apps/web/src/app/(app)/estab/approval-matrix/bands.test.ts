import { describe, it, expect } from "vitest";
import {
  labelForSourceType, validateBands, parseRoleTokens, SOURCE_TYPE_LABEL,
  labelForRole, readApproverCatalogue, rolesOutsideCatalogue,
} from "./bands";

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

describe("approver-role catalogue helpers (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  it("labelForRole title-cases a role code", () => {
    expect(labelForRole("deputy_secretary")).toBe("Deputy Secretary");
    expect(labelForRole("cto")).toBe("Cto");
  });

  it("readApproverCatalogue returns the configured roles, de-duplicated, in order", () => {
    expect(readApproverCatalogue({ approverRoles: { configured: true, roles: ["section_officer", "under_secretary", "section_officer"] } }))
      .toEqual(["section_officer", "under_secretary"]);
  });

  it("readApproverCatalogue is null when no list is configured, empty, malformed or absent", () => {
    expect(readApproverCatalogue({ approverRoles: { configured: false, roles: [] } })).toBeNull();
    expect(readApproverCatalogue({ approverRoles: { configured: true, roles: [] } })).toBeNull();
    expect(readApproverCatalogue({ approverRoles: { configured: true, roles: "x" } })).toBeNull();
    expect(readApproverCatalogue({ data: [] })).toBeNull();
    expect(readApproverCatalogue(null)).toBeNull();
  });

  it("readApproverCatalogue drops entries that are not valid role codes", () => {
    expect(readApproverCatalogue({ approverRoles: { configured: true, roles: ["director", "Bad Role", 5, "cto"] } }))
      .toEqual(["director", "cto"]);
  });

  it("rolesOutsideCatalogue lists the roles a chain names that the catalogue does not", () => {
    expect(rolesOutsideCatalogue(["director", "ghost"], ["director", "cto"])).toEqual(["ghost"]);
    expect(rolesOutsideCatalogue(["director"], ["director", "cto"])).toEqual([]);
  });
});
