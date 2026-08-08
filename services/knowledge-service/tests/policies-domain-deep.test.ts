/**
 * Knowledge Service — Policies Domain: Deep tests.
 *
 * Tests lifecycle state machine, maker-checker, effective-date evaluation,
 * acknowledgement rollup, and review-due computation.
 *
 * Source: modules/policies/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  canTransition, assertTransition, assertApproverDistinct,
  isEffective, acknowledgementRollup, isReviewDue, computeReviewDueDate,
  TRANSITIONS, LifecycleError, type PolicyStatus,
} from "../src/modules/policies/domain.js";

describe("canTransition — policy lifecycle state machine", () => {
  const valid: [PolicyStatus, PolicyStatus][] = [
    ["draft", "under_review"], ["draft", "withdrawn"],
    ["under_review", "approved"], ["under_review", "draft"], ["under_review", "withdrawn"],
    ["approved", "published"], ["approved", "under_review"], ["approved", "withdrawn"],
    ["published", "superseded"], ["published", "withdrawn"],
  ];
  for (const [from, to] of valid) {
    it(`${from} → ${to}`, () => expect(canTransition(from, to)).toBe(true));
  }

  it("superseded is terminal", () => {
    expect(canTransition("superseded", "draft")).toBe(false);
    expect(canTransition("superseded", "published")).toBe(false);
  });
  it("withdrawn is terminal", () => {
    expect(canTransition("withdrawn", "draft")).toBe(false);
  });
  it("draft → published is illegal (must review+approve first)", () => {
    expect(canTransition("draft", "published")).toBe(false);
  });
});

describe("assertTransition", () => {
  it("throws INVALID_TRANSITION for illegal move", () => {
    expect(() => assertTransition("draft", "published")).toThrow(LifecycleError);
  });
  it("does not throw for valid move", () => {
    expect(() => assertTransition("draft", "under_review")).not.toThrow();
  });
});

describe("assertApproverDistinct — maker-checker", () => {
  it("passes when author ≠ approver", () => {
    expect(() => assertApproverDistinct("user-A", "user-B")).not.toThrow();
  });
  it("throws MAKER_CHECKER for self-approval", () => {
    expect(() => assertApproverDistinct("user-A", "user-A")).toThrow(LifecycleError);
  });
});

describe("isEffective — in-force evaluation", () => {
  it("true when published + no effective date", () => {
    expect(isEffective({ status: "published", effectiveDate: null }, new Date())).toBe(true);
  });
  it("true when published + effective date in past", () => {
    expect(isEffective({ status: "published", effectiveDate: "2025-01-01" }, new Date("2026-07-01"))).toBe(true);
  });
  it("false when published + effective date in future", () => {
    expect(isEffective({ status: "published", effectiveDate: "2027-01-01" }, new Date("2026-07-01"))).toBe(false);
  });
  it("false when not published (draft)", () => {
    expect(isEffective({ status: "draft", effectiveDate: null }, new Date())).toBe(false);
  });
  it("false when superseded", () => {
    expect(isEffective({ status: "superseded", effectiveDate: "2020-01-01" }, new Date())).toBe(false);
  });
});

describe("acknowledgementRollup", () => {
  it("full acknowledgement → 100% rate", () => {
    const result = acknowledgementRollup(["A", "B", "C"], ["A", "B", "C"]);
    expect(result.acknowledgedCount).toBe(3);
    expect(result.pendingCount).toBe(0);
    expect(result.rate).toBe(100);
  });
  it("partial → correct rate", () => {
    const result = acknowledgementRollup(["A", "B", "C"], ["A"]);
    expect(result.acknowledgedCount).toBe(1);
    expect(result.pendingCount).toBe(2);
    expect(result.rate).toBeCloseTo(33.3, 0);
  });
  it("zero expected → 0% rate", () => {
    const result = acknowledgementRollup([], []);
    expect(result.rate).toBe(0);
  });
  it("deduplicates expected list", () => {
    const result = acknowledgementRollup(["A", "A", "B"], ["A"]);
    expect(result.total).toBe(2);
  });
});

describe("isReviewDue", () => {
  it("true when published + reviewDueDate in past", () => {
    expect(isReviewDue({ status: "published", reviewDueDate: "2025-01-01" }, new Date("2026-07-01"))).toBe(true);
  });
  it("false when no reviewDueDate", () => {
    expect(isReviewDue({ status: "published", reviewDueDate: null }, new Date())).toBe(false);
  });
  it("false when not published", () => {
    expect(isReviewDue({ status: "draft", reviewDueDate: "2020-01-01" }, new Date())).toBe(false);
  });
});

describe("computeReviewDueDate", () => {
  it("adds months to effective date", () => {
    expect(computeReviewDueDate("2026-01-15", 6)).toBe("2026-07-15");
  });
  it("crosses year boundary", () => {
    expect(computeReviewDueDate("2026-07-01", 12)).toBe("2027-07-01");
  });
});
