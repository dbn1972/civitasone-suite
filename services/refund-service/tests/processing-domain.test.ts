import { describe, it, expect } from "vitest";
import { getNextApprovalLevel, isFullyApproved, APPROVAL_LEVELS, APPROVAL_DECISIONS } from "../src/modules/processing/domain.js";

describe("getNextApprovalLevel", () => {
  it("expects level 1 when nothing has been approved yet", () => {
    expect(getNextApprovalLevel(0)).toBe(1);
  });

  it("expects level 2 once level 1 has been approved", () => {
    expect(getNextApprovalLevel(1)).toBe(2);
  });

  it("returns null once fully approved (no further level is valid)", () => {
    expect(getNextApprovalLevel(2)).toBeNull();
  });

  it("returns null for any level at or beyond AUTHORIZER, not just exactly 2", () => {
    expect(getNextApprovalLevel(3)).toBeNull();
    expect(getNextApprovalLevel(APPROVAL_LEVELS.AUTHORIZER)).toBeNull();
  });
});

describe("isFullyApproved", () => {
  it("is false below the authorizer level", () => {
    expect(isFullyApproved(0)).toBe(false);
    expect(isFullyApproved(1)).toBe(false);
  });

  it("is true at or above the authorizer level", () => {
    expect(isFullyApproved(2)).toBe(true);
    expect(isFullyApproved(3)).toBe(true);
  });
});

describe("APPROVAL_DECISIONS", () => {
  // SEQ-1 regression guard: this decision value is what
  // repo.supersedeApprovals writes on a return-for-correction. If someone
  // renames/removes it here without updating that call site (or vice versa),
  // this test fails loudly instead of the maker-checker reset silently
  // stopping working.
  it("includes 'superseded', the decision return-for-correction relies on", () => {
    expect(APPROVAL_DECISIONS).toContain("superseded");
  });
});
