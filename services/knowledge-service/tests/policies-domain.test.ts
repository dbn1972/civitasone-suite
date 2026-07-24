/**
 * SVC-126 — pure domain unit tests: lifecycle transitions, maker-checker,
 * effective-date logic, acknowledgement rollups, periodic-review scheduling.
 */
import { describe, it, expect } from "vitest";
import {
  TRANSITIONS,
  canTransition,
  assertTransition,
  assertApproverDistinct,
  isEffective,
  acknowledgementRollup,
  isReviewDue,
  computeReviewDueDate,
  LifecycleError,
  type PolicyStatus,
} from "../src/modules/policies/domain.js";

describe("policy lifecycle transitions", () => {
  it("allows the governed happy-path chain", () => {
    expect(canTransition("draft", "under_review")).toBe(true);
    expect(canTransition("under_review", "approved")).toBe(true);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("published", "superseded")).toBe(true);
    expect(canTransition("published", "withdrawn")).toBe(true);
  });

  it("allows sending a document back for rework", () => {
    expect(canTransition("under_review", "draft")).toBe(true);
    expect(canTransition("approved", "under_review")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("superseded", "published")).toBe(false);
    expect(canTransition("withdrawn", "draft")).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    expect(TRANSITIONS.superseded).toEqual([]);
    expect(TRANSITIONS.withdrawn).toEqual([]);
  });

  it("assertTransition throws INVALID_TRANSITION for illegal moves", () => {
    expect(() => assertTransition("draft", "published")).toThrowError(LifecycleError);
    try {
      assertTransition("draft", "published");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("assertTransition passes for legal moves", () => {
    expect(() => assertTransition("draft", "under_review")).not.toThrow();
  });
});

describe("maker-checker", () => {
  it("rejects self-approval (approver === author)", () => {
    expect(() => assertApproverDistinct("user-1", "user-1")).toThrowError(LifecycleError);
    try {
      assertApproverDistinct("user-1", "user-1");
    } catch (e) {
      expect((e as LifecycleError).code).toBe("MAKER_CHECKER");
    }
  });

  it("permits a distinct approver", () => {
    expect(() => assertApproverDistinct("author", "approver")).not.toThrow();
  });
});

describe("effective-date evaluation", () => {
  const asOf = new Date("2026-07-24T12:00:00Z");

  it("draft/approved documents are never in force", () => {
    expect(isEffective({ status: "approved", effectiveDate: "2026-01-01" }, asOf)).toBe(false);
    expect(isEffective({ status: "draft", effectiveDate: null }, asOf)).toBe(false);
  });

  it("published with a past effective date is in force", () => {
    expect(isEffective({ status: "published", effectiveDate: "2026-07-01" }, asOf)).toBe(true);
  });

  it("published with a future effective date is not yet in force", () => {
    expect(isEffective({ status: "published", effectiveDate: "2026-12-01" }, asOf)).toBe(false);
  });

  it("published with no effective date is in force immediately", () => {
    expect(isEffective({ status: "published", effectiveDate: null }, asOf)).toBe(true);
  });

  it("boundary: effective exactly at asOf is in force", () => {
    expect(isEffective({ status: "published", effectiveDate: "2026-07-24" }, new Date("2026-07-24T00:00:00Z"))).toBe(true);
  });
});

describe("acknowledgement rollup (who-has/who-hasn't)", () => {
  it("splits acknowledged vs pending and computes the rate", () => {
    const r = acknowledgementRollup(["a", "b", "c", "d"], ["a", "c"]);
    expect(r.total).toBe(4);
    expect(r.acknowledged).toEqual(["a", "c"]);
    expect(r.pending).toEqual(["b", "d"]);
    expect(r.acknowledgedCount).toBe(2);
    expect(r.pendingCount).toBe(2);
    expect(r.rate).toBe(50);
  });

  it("dedupes the expected roster", () => {
    const r = acknowledgementRollup(["a", "a", "b"], ["a"]);
    expect(r.total).toBe(2);
    expect(r.rate).toBe(50);
  });

  it("empty roster yields a zero rate (no divide-by-zero)", () => {
    const r = acknowledgementRollup([], []);
    expect(r.total).toBe(0);
    expect(r.rate).toBe(0);
  });

  it("ignores acked employees not on the roster", () => {
    const r = acknowledgementRollup(["a"], ["a", "z"]);
    expect(r.acknowledgedCount).toBe(1);
    expect(r.pending).toEqual([]);
    expect(r.rate).toBe(100);
  });
});

describe("periodic-review scheduling", () => {
  const asOf = new Date("2026-07-24T00:00:00Z");

  it("is due when review date is in the past for a published doc", () => {
    expect(isReviewDue({ status: "published", reviewDueDate: "2026-07-01" }, asOf)).toBe(true);
  });

  it("is not due when the review date is in the future", () => {
    expect(isReviewDue({ status: "published", reviewDueDate: "2026-12-01" }, asOf)).toBe(false);
  });

  it("is never due for non-published or dateless docs", () => {
    expect(isReviewDue({ status: "approved", reviewDueDate: "2026-01-01" }, asOf)).toBe(false);
    expect(isReviewDue({ status: "published", reviewDueDate: null }, asOf)).toBe(false);
  });

  it("computeReviewDueDate adds months across a year boundary", () => {
    expect(computeReviewDueDate("2026-07-24", 12)).toBe("2027-07-24");
    expect(computeReviewDueDate("2026-11-15", 3)).toBe("2027-02-15");
  });
});
