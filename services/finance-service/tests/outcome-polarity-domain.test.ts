/**
 * GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02 — indicator polarity (lower_is_better).
 * Pure unit tests over outcome-domain.ts.
 */
import { describe, it, expect } from "vitest";
import {
  achievementRatioBps,
  classifyAchievement,
  assertOutcomeLinkageValid,
} from "../src/modules/budget/outcome-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

const lower = { polarity: "lower_is_better" as const, baselineValue: 60n, targetValue: 30n };

describe("achievementRatioBps — lower_is_better", () => {
  it("scores a reading below the target as achieved (100%), never as a failure", () => {
    expect(achievementRatioBps(lower, 20n)).toBe(10_000n);
    expect(achievementRatioBps(lower, 0n)).toBe(10_000n);
    expect(classifyAchievement(lower, 20n)).toBe("achieved");
  });
  it("scores exactly the target as 100%", () => {
    expect(achievementRatioBps(lower, 30n)).toBe(10_000n);
  });
  it("scores halfway between baseline and target as 50%", () => {
    expect(achievementRatioBps(lower, 45n)).toBe(5_000n);
    expect(classifyAchievement(lower, 45n)).toBe("at_risk");
  });
  it("scores no improvement or a regression as 0", () => {
    expect(achievementRatioBps(lower, 60n)).toBe(0n);
    expect(achievementRatioBps(lower, 90n)).toBe(0n);
    expect(classifyAchievement(lower, 90n)).toBe("not_achieved");
  });
  it("keeps higher_is_better behaviour for an overshoot unchanged (default polarity)", () => {
    const higher = { baselineValue: 0n, targetValue: 100n };
    expect(achievementRatioBps(higher, 200n)).toBe(10_000n);
    expect(achievementRatioBps({ ...higher, polarity: "higher_is_better" }, 25n)).toBe(2_500n);
  });
});

describe("assertOutcomeLinkageValid — polarity", () => {
  const base = { indicator: "Days to settle", unit: "days", allocatedMinor: 0n };
  it("accepts baseline above target for lower_is_better", () => {
    expect(() => assertOutcomeLinkageValid({ ...base, ...lower })).not.toThrow();
  });
  it("rejects baseline at or below target for lower_is_better", () => {
    expect(() => assertOutcomeLinkageValid({ ...base, polarity: "lower_is_better", baselineValue: 30n, targetValue: 30n })).toThrow(DomainError);
    expect(() => assertOutcomeLinkageValid({ ...base, polarity: "lower_is_better", baselineValue: 10n, targetValue: 30n })).toThrow(/above the target/);
  });
  it("still rejects baseline at or above target for higher_is_better", () => {
    expect(() => assertOutcomeLinkageValid({ ...base, baselineValue: 60n, targetValue: 30n })).toThrow(/below the target/);
  });
});
