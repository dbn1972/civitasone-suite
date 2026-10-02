/**
 * GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-01 / NEW-02 -- pure validation, no DB.
 */
import { describe, it, expect } from "vitest";
import { assertValidHeadParent, DomainError } from "../src/modules/budget/domain.js";
import { updateHeadHoABody } from "../src/modules/budget/validators.js";

const HOA = "210100101010101010";

describe("assertValidHeadParent (NEW-02)", () => {
  it("a major head takes no parent", () => {
    expect(() => assertValidHeadParent(0, false, null)).not.toThrow();
    expect(() => assertValidHeadParent(0, true, { level: 0 })).toThrow(DomainError);
  });
  it("a minor / sub-minor head must name a parent", () => {
    expect(() => assertValidHeadParent(1, false, null)).toThrow(/needs a parent/);
    expect(() => assertValidHeadParent(2, false, null)).toThrow(DomainError);
  });
  it("an unknown parent (e.g. another tenant's id) is rejected", () => {
    try { assertValidHeadParent(1, true, null); throw new Error("expected throw"); }
    catch (e) { expect((e as DomainError).code).toBe("HEAD_PARENT_NOT_FOUND"); }
  });
  it("the parent must be exactly one level above", () => {
    expect(() => assertValidHeadParent(1, true, { level: 0 })).not.toThrow();
    expect(() => assertValidHeadParent(2, true, { level: 1 })).not.toThrow();
    expect(() => assertValidHeadParent(2, true, { level: 0 })).toThrow(/one level above/);
    expect(() => assertValidHeadParent(1, true, { level: 1 })).toThrow(DomainError);
  });
});

describe("updateHeadHoABody (NEW-01)", () => {
  it("requires a recorded reason", () => {
    expect(updateHeadHoABody.safeParse({ hoaCode: HOA }).success).toBe(false);
    expect(updateHeadHoABody.safeParse({ hoaCode: HOA, reason: "   " }).success).toBe(false);
    expect(updateHeadHoABody.safeParse({ hoaCode: HOA, reason: "ok" }).success).toBe(false);
  });
  it("accepts a valid code with a reason and trims it", () => {
    const r = updateHeadHoABody.parse({ hoaCode: HOA, reason: "  Aligning with PFMS mapping " });
    expect(r.reason).toBe("Aligning with PFMS mapping");
  });
  it("still rejects a malformed HoA code", () => {
    expect(updateHeadHoABody.safeParse({ hoaCode: "123", reason: "Aligning with PFMS" }).success).toBe(false);
  });
});
