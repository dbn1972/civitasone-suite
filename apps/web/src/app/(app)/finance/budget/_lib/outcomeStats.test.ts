import { describe, it, expect } from "vitest";
import { classifyOutcomes, achievementBpsOrNull } from "./outcomeStats";

// GAP-FINANCE-BUDGET-OUTCOME-BUDGET-03
describe("classifyOutcomes", () => {
  it("separates 'not measured' (null/absent/garbage) from 'not started' (0 or negative)", () => {
    const r = classifyOutcomes([
      { achievementBps: null }, { achievementBps: "0" }, { achievementBps: "5000" },
      { achievementBps: "10000" }, { achievementBps: "-10" }, {}, { achievementBps: "abc" }, { achievementBps: "" },
    ]);
    expect(r).toEqual({ achieved: 1, inProgress: 1, notStarted: 2, notMeasured: 4 });
  });
  it("achievementBpsOrNull", () => {
    expect(achievementBpsOrNull("2500")).toBe(2500);
    expect(achievementBpsOrNull(null)).toBeNull();
    expect(achievementBpsOrNull("NaN")).toBeNull();
  });
});
