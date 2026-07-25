/**
 * SVC-031 — budget formulation pure domain tests. No DB/IO.
 */
import { describe, it, expect } from "vitest";
import {
  ceilingBreachMinor,
  assertProposalValid,
  nextVersion,
  assertProposalTransition,
  assertProposalApproverDistinct,
  consolidateProposals,
} from "../src/modules/budget/formulation-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("formulation — ceilingBreachMinor()", () => {
  it("returns 0 within ceiling", () => {
    expect(ceilingBreachMinor(1000n, 800n)).toBe(0n);
    expect(ceilingBreachMinor(1000n, 1000n)).toBe(0n);
  });
  it("returns the excess above the ceiling", () => {
    expect(ceilingBreachMinor(1000n, 1300n)).toBe(300n);
  });
});

describe("formulation — assertProposalValid()", () => {
  it("accepts a proposal within ceiling without justification", () => {
    expect(() => assertProposalValid({ ceilingMinor: 1000n, proposedMinor: 900n, justification: "" })).not.toThrow();
  });
  it("accepts a breach with substantive justification", () => {
    expect(() => assertProposalValid({ ceilingMinor: 1000n, proposedMinor: 1500n, justification: "New statutory mandate funding" })).not.toThrow();
  });
  it("rejects a breach without justification (CEILING_BREACH)", () => {
    expect(() => assertProposalValid({ ceilingMinor: 1000n, proposedMinor: 1500n, justification: "too short" }))
      .toThrow(/CEILING_BREACH/);
    try { assertProposalValid({ ceilingMinor: 1000n, proposedMinor: 1500n, justification: "" }); }
    catch (e) { expect((e as DomainError).code).toBe("CEILING_BREACH"); }
  });
  it("rejects non-positive proposals", () => {
    expect(() => assertProposalValid({ ceilingMinor: 1000n, proposedMinor: 0n, justification: "x" })).toThrow(/INVALID_PROPOSAL/);
  });
  it("rejects negative ceiling", () => {
    expect(() => assertProposalValid({ ceilingMinor: -1n, proposedMinor: 100n, justification: "x" })).toThrow(/INVALID_PROPOSAL/);
  });
});

describe("formulation — nextVersion()", () => {
  it("increments", () => { expect(nextVersion(1)).toBe(2); expect(nextVersion(7)).toBe(8); });
});

describe("formulation — assertProposalTransition()", () => {
  it("allows the lifecycle path", () => {
    expect(() => assertProposalTransition("draft", "submitted")).not.toThrow();
    expect(() => assertProposalTransition("submitted", "under_review")).not.toThrow();
    expect(() => assertProposalTransition("under_review", "approved")).not.toThrow();
    expect(() => assertProposalTransition("submitted", "returned")).not.toThrow();
    expect(() => assertProposalTransition("returned", "submitted")).not.toThrow();
  });
  it("blocks illegal jumps", () => {
    expect(() => assertProposalTransition("draft", "approved")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertProposalTransition("approved", "submitted")).toThrow(/INVALID_TRANSITION/);
    expect(() => assertProposalTransition("draft", "under_review")).toThrow(DomainError);
  });
});

describe("formulation — assertProposalApproverDistinct() (maker-checker)", () => {
  it("passes for distinct officers", () => {
    expect(() => assertProposalApproverDistinct("maker", "checker")).not.toThrow();
  });
  it("throws for self-approval", () => {
    expect(() => assertProposalApproverDistinct("same", "same")).toThrow(/MAKER_CHECKER_VIOLATION/);
  });
});

describe("formulation — consolidateProposals()", () => {
  it("sums ceilings, proposals and computes aggregate breach", () => {
    const c = consolidateProposals([
      { ceilingMinor: 1000n, proposedMinor: 1200n },
      { ceilingMinor: 2000n, proposedMinor: 1500n },
      { ceilingMinor: 500n, proposedMinor: 900n },
    ]);
    expect(c.count).toBe(3);
    expect(c.totalCeilingMinor).toBe(3500n);
    expect(c.totalProposedMinor).toBe(3600n);
    expect(c.totalBreachMinor).toBe(100n); // 3600 - 3500
  });
  it("reports zero breach when aggregate demand is within aggregate ceiling", () => {
    const c = consolidateProposals([
      { ceilingMinor: 1000n, proposedMinor: 1200n },
      { ceilingMinor: 2000n, proposedMinor: 1000n },
    ]);
    expect(c.totalBreachMinor).toBe(0n);
  });
  it("handles an empty set", () => {
    const c = consolidateProposals([]);
    expect(c.count).toBe(0);
    expect(c.totalProposedMinor).toBe(0n);
  });
});
