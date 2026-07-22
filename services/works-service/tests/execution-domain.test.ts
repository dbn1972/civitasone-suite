/**
 * Execution domain tests — closure eligibility (BR-029 to BR-034),
 * parent/split consistency, progress percentage, physical completion (BR-035).
 */
import { describe, it, expect } from "vitest";
import {
  closureEligibility,
  canRecordPhysicalCompletion,
  validateProgressNotExceedTarget,
  parentSplitConsistency,
} from "../src/modules/execution/domain.js";

describe("closureEligibility", () => {
  it("returns 'closed' when no agreement exists", () => {
    const result = closureEligibility({
      id: "w1",
      status: "active",
      hasAgreement: false,
      hasSplits: false,
      allSplitsClosed: true,
      hasPhysicalCompletion: false,
    });
    expect(result).toBe("closed");
  });

  it("returns 'completion' when has agreement and physical completion", () => {
    const result = closureEligibility({
      id: "w1",
      status: "active",
      hasAgreement: true,
      hasSplits: false,
      allSplitsClosed: true,
      hasPhysicalCompletion: true,
    });
    expect(result).toBe("completion");
  });

  it("returns 'dropped' when has agreement but no physical completion", () => {
    const result = closureEligibility({
      id: "w1",
      status: "active",
      hasAgreement: true,
      hasSplits: false,
      allSplitsClosed: true,
      hasPhysicalCompletion: false,
    });
    expect(result).toBe("dropped");
  });

  it("returns 'closed' for work without agreement regardless of splits", () => {
    const result = closureEligibility({
      id: "w1",
      status: "active",
      hasAgreement: false,
      hasSplits: true,
      allSplitsClosed: false,
      hasPhysicalCompletion: false,
    });
    expect(result).toBe("closed");
  });
});

describe("canRecordPhysicalCompletion (BR-035)", () => {
  it("allows physical completion when agreement exists", () => {
    expect(canRecordPhysicalCompletion(true)).toBe(true);
  });

  it("blocks physical completion when no agreement exists", () => {
    expect(canRecordPhysicalCompletion(false)).toBe(false);
  });
});

describe("validateProgressNotExceedTarget", () => {
  it("returns true when cumulative is within target", () => {
    expect(validateProgressNotExceedTarget(50, 100)).toBe(true);
  });

  it("returns true when cumulative equals target", () => {
    expect(validateProgressNotExceedTarget(100, 100)).toBe(true);
  });

  it("returns false when cumulative exceeds target", () => {
    expect(validateProgressNotExceedTarget(101, 100)).toBe(false);
  });

  it("handles zero values", () => {
    expect(validateProgressNotExceedTarget(0, 0)).toBe(true);
    expect(validateProgressNotExceedTarget(0, 100)).toBe(true);
  });

  it("handles decimal values", () => {
    expect(validateProgressNotExceedTarget(99.99, 100)).toBe(true);
    expect(validateProgressNotExceedTarget(100.01, 100)).toBe(false);
  });
});

describe("parentSplitConsistency (BR-032)", () => {
  it("returns true when no splits exist", () => {
    expect(parentSplitConsistency("active", [], "closed")).toBe(true);
  });

  it("returns true for closure when all splits are closed", () => {
    const splits = [
      { id: "s1", status: "closed" },
      { id: "s2", status: "closed" },
    ];
    expect(parentSplitConsistency("active", splits, "closed")).toBe(true);
  });

  it("returns false for closure when some splits are still active", () => {
    const splits = [
      { id: "s1", status: "closed" },
      { id: "s2", status: "active" },
    ];
    expect(parentSplitConsistency("active", splits, "closed")).toBe(false);
  });

  it("returns false for completion when some splits are open", () => {
    const splits = [
      { id: "s1", status: "active" },
    ];
    expect(parentSplitConsistency("active", splits, "completion")).toBe(false);
  });

  it("returns true for non-closure transitions regardless of split status", () => {
    const splits = [
      { id: "s1", status: "active" },
    ];
    expect(parentSplitConsistency("draft", splits, "dao_finalized")).toBe(true);
  });
});
