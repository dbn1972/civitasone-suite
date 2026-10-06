import { describe, it, expect } from "vitest";
import { summariseCalls } from "./callSummary";

const c = (status: string, abandoned: boolean, slaAnswered: boolean | null) => ({ status, abandoned, slaAnswered });

describe("summariseCalls", () => {
  it("counts live (queued/ringing), answered (answered/completed) and abandoned", () => {
    const s = summariseCalls([
      c("queued", false, null),
      c("ringing", false, null),
      c("answered", false, true),
      c("completed", false, true),
      c("abandoned", true, null),
    ]);
    expect(s.total).toBe(5);
    expect(s.live).toBe(2);
    expect(s.answered).toBe(2);
    expect(s.abandoned).toBe(1);
  });

  // GAP-TELEPHONY-CALLS-02: no scored calls -> slaPct null (render "—"), never 100.
  it("returns slaPct null when no call is scored", () => {
    expect(summariseCalls([]).slaPct).toBeNull();
    expect(summariseCalls([c("queued", false, null)]).slaPct).toBeNull();
  });

  it("computes slaPct over scored calls (3 of 4 met -> 75%)", () => {
    const s = summariseCalls([
      c("completed", false, true),
      c("completed", false, true),
      c("completed", false, true),
      c("completed", false, false),
    ]);
    expect(s.slaScored).toBe(4);
    expect(s.slaMet).toBe(3);
    expect(s.slaPct).toBe(75);
  });
});
