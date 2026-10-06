import { describe, it, expect } from "vitest";
import { rangesOverlap, freezesConflictingWith, freezeState } from "./calendar";
import type { ChangeFreeze, ChangeRequest } from "./types";

const freeze = (over: Partial<ChangeFreeze>): ChangeFreeze => ({
  id: "f1", name: "YE freeze", startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-10T00:00:00.000Z", reason: "close", ...over,
});

describe("rangesOverlap (GAP-CHANGE-CALENDAR-01)", () => {
  it("true for partially overlapping ranges", () => {
    expect(rangesOverlap(
      "2026-09-05T02:00:00.000Z", "2026-09-05T04:00:00.000Z",
      "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z",
    )).toBe(true);
  });

  it("false for adjacent ranges (one ends exactly when the other starts)", () => {
    expect(rangesOverlap(
      "2026-09-10T00:00:00.000Z", "2026-09-11T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z",
    )).toBe(false);
  });

  it("false for disjoint ranges", () => {
    expect(rangesOverlap(
      "2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z",
    )).toBe(false);
  });

  it("false (never a false positive) when a bound is missing/invalid", () => {
    expect(rangesOverlap(null, "x", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(false);
    expect(rangesOverlap("not-a-date", "2026-09-05T04:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-09-10T00:00:00.000Z")).toBe(false);
  });
});

describe("freezesConflictingWith", () => {
  const change = (over: Partial<ChangeRequest>): ChangeRequest => ({
    id: "c1", title: "t", type: "normal", risk: "high", affectedServices: [], description: "",
    rollbackPlan: null, status: "scheduled", requestedBy: "r", approvedBy: null, approvedAt: null,
    rejectedReason: null, windowStart: null, windowEnd: null, releaseNotes: null, pirOutcome: null,
    pirNotes: null, pirAt: null, createdAt: "", updatedAt: "", ...over,
  });

  it("returns the overlapping freeze for a window inside it", () => {
    const c = change({ windowStart: "2026-09-05T02:00:00.000Z", windowEnd: "2026-09-05T04:00:00.000Z" });
    const result = freezesConflictingWith(c, [freeze({})]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("YE freeze");
  });

  it("returns nothing for a window with no booked times", () => {
    expect(freezesConflictingWith(change({}), [freeze({})])).toHaveLength(0);
  });

  it("returns nothing for a window clear of all freezes", () => {
    const c = change({ windowStart: "2026-12-01T02:00:00.000Z", windowEnd: "2026-12-01T04:00:00.000Z" });
    expect(freezesConflictingWith(c, [freeze({})])).toHaveLength(0);
  });
});

describe("freezeState (GAP-CHANGE-CALENDAR-03)", () => {
  const now = new Date("2026-09-05T00:00:00.000Z");
  it("upcoming when now precedes the start", () => {
    expect(freezeState(freeze({ startsAt: "2026-09-10T00:00:00.000Z", endsAt: "2026-09-12T00:00:00.000Z" }), now)).toBe("upcoming");
  });
  it("active when now is inside the window", () => {
    expect(freezeState(freeze({}), now)).toBe("active");
  });
  it("ended when now is at/after the end", () => {
    expect(freezeState(freeze({ startsAt: "2026-08-01T00:00:00.000Z", endsAt: "2026-08-10T00:00:00.000Z" }), now)).toBe("ended");
  });
  it("treats an unparseable window as active (fail-safe, never silently hidden)", () => {
    expect(freezeState(freeze({ startsAt: "bad", endsAt: "bad" }), now)).toBe("active");
  });
});
