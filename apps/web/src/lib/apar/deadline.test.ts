import { describe, it, expect } from "vitest";
import { deadlineState } from "./deadline";

describe("deadlineState (GAP-HR-APAR-03)", () => {
  const today = "2026-04-25";
  it("counts days until a future deadline", () => {
    expect(deadlineState("2026-04-30", today, false)).toEqual({ kind: "due", days: 5 });
  });
  it("due today", () => {
    expect(deadlineState("2026-04-25", today, false)).toEqual({ kind: "today" });
  });
  it("overdue by whole days, across a month boundary", () => {
    expect(deadlineState("2026-04-23", today, false)).toEqual({ kind: "overdue", days: 2 });
    expect(deadlineState("2026-03-31", today, false)).toEqual({ kind: "overdue", days: 25 });
  });
  it("nothing for a finalised record, a missing deadline or a malformed one", () => {
    expect(deadlineState("2026-04-30", today, true)).toBeNull();
    expect(deadlineState(null, today, false)).toBeNull();
    expect(deadlineState(undefined, today, false)).toBeNull();
    expect(deadlineState("30/04/2026", today, false)).toBeNull();
  });
});
