/**
 * Proposal domain tests — work number generation, category validation,
 * COA validation, split rules, DAO finalization preconditions.
 */
import { describe, it, expect } from "vitest";
import {
  generateWorkNumber,
  resolveCategory,
  canDaoFinalize,
  validateCoa,
  canDeleteSplit,
  isNodalOffice,
} from "../src/modules/proposal/domain.js";

describe("generateWorkNumber", () => {
  it("formats as DIVISION/YEAR/SEQUENCE with zero-padded sequence", () => {
    expect(generateWorkNumber("PWD-PUN", 2024, 1)).toBe("PWD-PUN/2024/0001");
    expect(generateWorkNumber("PWD-PUN", 2024, 42)).toBe("PWD-PUN/2024/0042");
    expect(generateWorkNumber("PWD-PUN", 2024, 9999)).toBe("PWD-PUN/2024/9999");
  });

  it("handles different division codes", () => {
    expect(generateWorkNumber("WRD-MUM", 2025, 100)).toBe("WRD-MUM/2025/0100");
    expect(generateWorkNumber("BLDG", 2023, 5)).toBe("BLDG/2023/0005");
  });

  it("sequence above 9999 is not zero-padded", () => {
    expect(generateWorkNumber("DIV", 2024, 10001)).toBe("DIV/2024/10001");
  });
});

describe("resolveCategory", () => {
  it("resolves 'regular' correctly", () => {
    expect(resolveCategory("regular")).toBe("regular");
    expect(resolveCategory("Regular")).toBe("regular");
    expect(resolveCategory(" REGULAR ")).toBe("regular");
  });

  it("resolves 'deposit' correctly", () => {
    expect(resolveCategory("deposit")).toBe("deposit");
    expect(resolveCategory("Deposit")).toBe("deposit");
  });

  it("resolves 'salary' correctly", () => {
    expect(resolveCategory("salary")).toBe("salary");
    expect(resolveCategory("SALARY")).toBe("salary");
  });

  it("throws on invalid category", () => {
    expect(() => resolveCategory("invalid")).toThrow("Invalid category");
    expect(() => resolveCategory("")).toThrow("Invalid category");
  });
});

describe("canDaoFinalize", () => {
  const validProposal = {
    id: "p1",
    status: "draft",
    description: "Road repair work",
    workTypeId: "wt-1",
    estimatedCostMinor: 1000000n,
  };

  it("allows finalization for valid draft proposal", () => {
    const result = canDaoFinalize(validProposal);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks finalization if not in draft status", () => {
    const result = canDaoFinalize({ ...validProposal, status: "dao_finalized" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("dao_finalized");
  });

  it("blocks finalization if description is empty", () => {
    const result = canDaoFinalize({ ...validProposal, description: "" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("description");
  });

  it("blocks finalization if description is whitespace only", () => {
    const result = canDaoFinalize({ ...validProposal, description: "   " });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("description");
  });

  it("blocks finalization if work type is missing", () => {
    const result = canDaoFinalize({ ...validProposal, workTypeId: "" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("work type");
  });

  it("blocks finalization if estimated cost is zero", () => {
    const result = canDaoFinalize({ ...validProposal, estimatedCostMinor: 0n });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("estimated cost");
  });

  it("blocks finalization if estimated cost is negative", () => {
    const result = canDaoFinalize({ ...validProposal, estimatedCostMinor: -100n });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("estimated cost");
  });
});

describe("validateCoa", () => {
  it("valid COA with all heads", () => {
    const result = validateCoa({
      majorHead: "2059",
      subMajorHead: "01",
      minorHead: "101",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("valid COA with only majorHead", () => {
    const result = validateCoa({ majorHead: "3054" });
    expect(result.valid).toBe(true);
  });

  it("invalid: missing majorHead", () => {
    const result = validateCoa({ majorHead: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("majorHead is required");
  });

  it("invalid: majorHead not 4 digits", () => {
    const result = validateCoa({ majorHead: "123" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("4-digit"))).toBe(true);
  });

  it("invalid: majorHead with letters", () => {
    const result = validateCoa({ majorHead: "ABCD" });
    expect(result.valid).toBe(false);
  });

  it("invalid: subMajorHead not 2 digits", () => {
    const result = validateCoa({ majorHead: "2059", subMajorHead: "1" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("2-digit"))).toBe(true);
  });

  it("invalid: minorHead not 3 digits", () => {
    const result = validateCoa({ majorHead: "2059", minorHead: "12" });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("3-digit"))).toBe(true);
  });

  it("null optional heads are ok", () => {
    const result = validateCoa({ majorHead: "2059", subMajorHead: null, minorHead: null });
    expect(result.valid).toBe(true);
  });
});

describe("canDeleteSplit", () => {
  it("allows deletion of active split without dependents", () => {
    expect(canDeleteSplit({ id: "s1", status: "active" }, false)).toBe(true);
  });

  it("blocks deletion of closed split", () => {
    expect(canDeleteSplit({ id: "s1", status: "closed" }, false)).toBe(false);
  });

  it("blocks deletion when split has dependents", () => {
    expect(canDeleteSplit({ id: "s1", status: "active" }, true)).toBe(false);
  });
});

describe("isNodalOffice", () => {
  it("returns true for nodal office", () => {
    expect(isNodalOffice({ workId: "w1", divisionId: "d1", isNodal: true })).toBe(true);
  });

  it("returns false for non-nodal office", () => {
    expect(isNodalOffice({ workId: "w1", divisionId: "d1", isNodal: false })).toBe(false);
  });
});
