import { describe, it, expect } from "vitest";
import { goalHealth, statusAfterCheckin, AT_RISK_SHORTFALL_PCT, BEHIND_SHORTFALL_PCT } from "./goal-health.js";

// Goal window: created 1 Jan, due 31 Jan (30 days). Day N of the window = N/30 expected.
const created = "2026-01-01T00:00:00Z";
const due = "2026-01-31";
const g = (over: Partial<Parameters<typeof goalHealth>[0]> = {}) => ({ status: "active", progress: 0, createdAt: created, dueDate: due, ...over });

describe("goalHealth (GAP-HR-GOALS-04)", () => {
  it("the acceptance case: 20% progress with the due date 3 days away is behind (expected ~90%)", () => {
    expect(goalHealth(g({ progress: 20 }), "2026-01-28")).toBe("behind");
  });
  it("on track when progress keeps pace; at risk when 15-30 points short; behind beyond 30", () => {
    // 15 Jan = 50% elapsed
    expect(goalHealth(g({ progress: 50 }), "2026-01-16")).toBe("on_track");
    expect(goalHealth(g({ progress: 40 }), "2026-01-16")).toBe("on_track"); // 10 short
    expect(goalHealth(g({ progress: 30 }), "2026-01-16")).toBe("at_risk");  // 20 short
    expect(goalHealth(g({ progress: 10 }), "2026-01-16")).toBe("behind");   // 40 short
    expect(AT_RISK_SHORTFALL_PCT).toBeLessThan(BEHIND_SHORTFALL_PCT);
  });
  it("exactly at a threshold is not yet over it", () => {
    // day 15 of 30 -> expected 50; progress 35 -> shortfall exactly 15 -> still on track
    expect(goalHealth(g({ progress: 35 }), "2026-01-16")).toBe("on_track");
    expect(goalHealth(g({ progress: 20 }), "2026-01-16")).toBe("at_risk"); // exactly 30 -> at risk, not behind
  });
  it("past the due date and under 100% is behind; 100% is completed whatever the date", () => {
    expect(goalHealth(g({ progress: 80 }), "2026-02-02")).toBe("behind");
    expect(goalHealth(g({ progress: 100 }), "2026-02-02")).toBe("completed");
  });
  it("no due date -> nothing to measure against -> on_track", () => {
    expect(goalHealth(g({ dueDate: null, progress: 0 }), "2026-06-01")).toBe("on_track");
  });
  it("completed/achieved stay; a manually set at_risk/behind/on_track is respected, never recomputed", () => {
    expect(goalHealth(g({ status: "completed" }), "2026-01-28")).toBe("completed");
    expect(goalHealth(g({ status: "achieved", progress: 10 }), "2026-01-28")).toBe("completed");
    expect(goalHealth(g({ status: "at_risk", progress: 95 }), "2026-01-16")).toBe("at_risk");
    expect(goalHealth(g({ status: "on_track", progress: 0 }), "2026-02-20")).toBe("on_track");
  });
  it("progress arriving as a numeric string (postgres) is handled", () => {
    expect(goalHealth(g({ progress: "20" }), "2026-01-28")).toBe("behind");
  });
  it("a goal due the day it was created, not yet done, is not divided by zero", () => {
    expect(goalHealth(g({ dueDate: "2026-01-01", progress: 0 }), "2026-01-01")).toBe("behind");
  });
});

describe("statusAfterCheckin", () => {
  it("completion wins", () => { expect(statusAfterCheckin("at_risk", 100)).toBe("completed"); });
  it("a manually set health survives a check-in (the old code reset it to 'active')", () => {
    expect(statusAfterCheckin("at_risk", 40)).toBe("at_risk");
    expect(statusAfterCheckin("behind", 10)).toBe("behind");
    expect(statusAfterCheckin("on_track", 10)).toBe("on_track");
  });
  it("an automatic goal stays 'active'", () => {
    expect(statusAfterCheckin("active", 40)).toBe("active");
    expect(statusAfterCheckin("completed", 40)).toBe("active");
  });
});
