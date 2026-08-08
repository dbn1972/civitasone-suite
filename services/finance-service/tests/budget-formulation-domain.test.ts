/**
 * Budget Formulation Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/formulation-domain.ts
 * Covers: ceiling breach, proposal validation, state machine, maker-checker,
 * version bumping, consolidation.
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

describe("ceilingBreachMinor", () => {
  it("returns 0 when proposed equals ceiling", () => {
    expect(ceilingBreachMinor(100_000n, 100_000n)).toBe(0n);
  });

  it("returns 0 when proposed is below ceiling", () => {
    expect(ceilingBreachMinor(100_000n, 50_000n)).toBe(0n);
  });

  it("returns the excess when proposed exceeds ceiling", () => {
    expect(ceilingBreachMinor(100_000n, 150_000n)).toBe(50_000n);
  });

  it("returns 0 when both are zero", () => {
    expect(ceilingBreachMinor(0n, 0n)).toBe(0n);
  });
});

describe("assertProposalValid", () => {
  it("passes when within ceiling (no justification needed)", () => {
    expect(() => assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 80_000n, justification: "" })).not.toThrow();
  });

  it("passes when at ceiling (no breach)", () => {
    expect(() => assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 100_000n, justification: "" })).not.toThrow();
  });

  it("passes when breaching ceiling with sufficient justification (≥10 chars)", () => {
    expect(() => assertProposalValid({
      ceilingMinor: 100_000n, proposedMinor: 150_000n,
      justification: "Urgent infrastructure deficit requires additional provisioning beyond the communicated ceiling.",
    })).not.toThrow();
  });

  it("throws CEILING_BREACH when breaching ceiling without justification", () => {
    expect(() => assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 100_001n, justification: "" })).toThrow(DomainError);
    try {
      assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 100_001n, justification: "short" });
    } catch (e) {
      expect((e as DomainError).code).toBe("CEILING_BREACH");
    }
  });

  it("throws INVALID_PROPOSAL for zero proposed", () => {
    expect(() => assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 0n, justification: "" })).toThrow(DomainError);
    try { assertProposalValid({ ceilingMinor: 100_000n, proposedMinor: 0n, justification: "" }); } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_PROPOSAL");
    }
  });

  it("throws INVALID_PROPOSAL for negative ceiling", () => {
    expect(() => assertProposalValid({ ceilingMinor: -1n, proposedMinor: 100n, justification: "" })).toThrow(DomainError);
  });
});

describe("nextVersion", () => {
  it("increments by 1", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(5)).toBe(6);
    expect(nextVersion(0)).toBe(1);
  });
});

describe("assertProposalTransition (state machine)", () => {
  it("draft → submitted", () => { expect(() => assertProposalTransition("draft", "submitted")).not.toThrow(); });
  it("submitted → under_review", () => { expect(() => assertProposalTransition("submitted", "under_review")).not.toThrow(); });
  it("submitted → returned", () => { expect(() => assertProposalTransition("submitted", "returned")).not.toThrow(); });
  it("submitted → approved", () => { expect(() => assertProposalTransition("submitted", "approved")).not.toThrow(); });
  it("under_review → approved", () => { expect(() => assertProposalTransition("under_review", "approved")).not.toThrow(); });
  it("under_review → returned", () => { expect(() => assertProposalTransition("under_review", "returned")).not.toThrow(); });
  it("returned → submitted (re-submission)", () => { expect(() => assertProposalTransition("returned", "submitted")).not.toThrow(); });

  it("approved is terminal", () => {
    expect(() => assertProposalTransition("approved", "draft")).toThrow(DomainError);
    expect(() => assertProposalTransition("approved", "submitted")).toThrow(DomainError);
  });

  it("draft → approved (skip review) → INVALID_TRANSITION", () => {
    expect(() => assertProposalTransition("draft", "approved")).toThrow(DomainError);
  });

  it("draft → returned (skip submission) → INVALID_TRANSITION", () => {
    expect(() => assertProposalTransition("draft", "returned")).toThrow(DomainError);
  });
});

describe("assertProposalApproverDistinct (maker-checker)", () => {
  it("passes for different officers", () => {
    expect(() => assertProposalApproverDistinct("user-a", "user-b")).not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION for same officer", () => {
    expect(() => assertProposalApproverDistinct("user-a", "user-a")).toThrow(DomainError);
  });
});

describe("consolidateProposals", () => {
  it("sums multiple proposals correctly", () => {
    const result = consolidateProposals([
      { ceilingMinor: 100_000n, proposedMinor: 120_000n },
      { ceilingMinor: 200_000n, proposedMinor: 180_000n },
      { ceilingMinor: 50_000n, proposedMinor: 60_000n },
    ]);
    expect(result.count).toBe(3);
    expect(result.totalCeilingMinor).toBe(350_000n);
    expect(result.totalProposedMinor).toBe(360_000n);
    expect(result.totalBreachMinor).toBe(10_000n); // 360k - 350k
  });

  it("returns zero breach when total proposed is within total ceiling", () => {
    const result = consolidateProposals([
      { ceilingMinor: 100_000n, proposedMinor: 80_000n },
      { ceilingMinor: 200_000n, proposedMinor: 150_000n },
    ]);
    expect(result.totalBreachMinor).toBe(0n);
  });

  it("handles empty array", () => {
    const result = consolidateProposals([]);
    expect(result.count).toBe(0);
    expect(result.totalCeilingMinor).toBe(0n);
    expect(result.totalProposedMinor).toBe(0n);
    expect(result.totalBreachMinor).toBe(0n);
  });
});
