/**
 * Budget Outcome Domain — pure unit tests.
 *
 * Source: services/finance-service/src/modules/budget/outcome-domain.ts
 * Covers: achievement ratio, classification, linkage validation,
 * achievement validation, maker-checker.
 */
import { describe, it, expect } from "vitest";
import {
  achievementRatioBps,
  classifyAchievement,
  assertOutcomeLinkageValid,
  assertAchievementValid,
  assertEvaluatorDistinct,
} from "../src/modules/budget/outcome-domain.js";
import { DomainError } from "../src/modules/budget/domain.js";

describe("achievementRatioBps", () => {
  it("returns 10000 (100%) when achieved equals target", () => {
    expect(achievementRatioBps({ targetValue: 100n, baselineValue: 0n }, 100n)).toBe(10_000n);
  });

  it("returns 5000 (50%) when halfway", () => {
    expect(achievementRatioBps({ targetValue: 100n, baselineValue: 0n }, 50n)).toBe(5_000n);
  });

  it("returns 0 when achieved equals baseline (no progress)", () => {
    expect(achievementRatioBps({ targetValue: 100n, baselineValue: 20n }, 20n)).toBe(0n);
  });

  it("returns 0 when achieved is below baseline (negative progress)", () => {
    expect(achievementRatioBps({ targetValue: 100n, baselineValue: 50n }, 30n)).toBe(0n);
  });

  it("caps at 10000 (100%) when over-achieved", () => {
    expect(achievementRatioBps({ targetValue: 100n, baselineValue: 0n }, 200n)).toBe(10_000n);
  });

  it("returns 10000 when target equals baseline (nothing to achieve)", () => {
    expect(achievementRatioBps({ targetValue: 50n, baselineValue: 50n }, 50n)).toBe(10_000n);
  });

  it("returns 10000 when target < baseline (inverted — edge)", () => {
    expect(achievementRatioBps({ targetValue: 30n, baselineValue: 50n }, 40n)).toBe(10_000n);
  });

  it("handles large values without precision loss", () => {
    const target = 1_000_000_000n;
    const baseline = 0n;
    const achieved = 750_000_000n;
    expect(achievementRatioBps({ targetValue: target, baselineValue: baseline }, achieved)).toBe(7_500n);
  });
});

describe("classifyAchievement", () => {
  const link = { targetValue: 100n, baselineValue: 0n };

  it("achieved when >= 100%", () => {
    expect(classifyAchievement(link, 100n)).toBe("achieved");
    expect(classifyAchievement(link, 150n)).toBe("achieved");
  });

  it("on_track when >= 75% and < 100%", () => {
    expect(classifyAchievement(link, 75n)).toBe("on_track");
    expect(classifyAchievement(link, 99n)).toBe("on_track");
  });

  it("at_risk when >= 50% and < 75%", () => {
    expect(classifyAchievement(link, 50n)).toBe("at_risk");
    expect(classifyAchievement(link, 74n)).toBe("at_risk");
  });

  it("not_achieved when < 50%", () => {
    expect(classifyAchievement(link, 0n)).toBe("not_achieved");
    expect(classifyAchievement(link, 49n)).toBe("not_achieved");
  });
});

describe("assertOutcomeLinkageValid", () => {
  const valid = { indicator: "km of road built", unit: "km", targetValue: 100n, baselineValue: 10n, allocatedMinor: 500_000n };

  it("passes for valid linkage", () => {
    expect(() => assertOutcomeLinkageValid(valid)).not.toThrow();
  });

  it("throws for empty indicator", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, indicator: "" })).toThrow(DomainError);
    expect(() => assertOutcomeLinkageValid({ ...valid, indicator: "   " })).toThrow(DomainError);
  });

  it("throws for empty unit", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, unit: "" })).toThrow(DomainError);
  });

  it("throws for zero target", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, targetValue: 0n })).toThrow(DomainError);
  });

  it("throws for negative baseline", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, baselineValue: -1n })).toThrow(DomainError);
  });

  it("throws when baseline >= target", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, baselineValue: 100n, targetValue: 100n })).toThrow(DomainError);
    expect(() => assertOutcomeLinkageValid({ ...valid, baselineValue: 101n, targetValue: 100n })).toThrow(DomainError);
  });

  it("throws for negative allocatedMinor", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, allocatedMinor: -1n })).toThrow(DomainError);
  });

  it("passes for zero allocatedMinor (unfunded outcome)", () => {
    expect(() => assertOutcomeLinkageValid({ ...valid, allocatedMinor: 0n })).not.toThrow();
  });
});

describe("assertAchievementValid", () => {
  it("passes for zero", () => { expect(() => assertAchievementValid(0n)).not.toThrow(); });
  it("passes for positive", () => { expect(() => assertAchievementValid(100n)).not.toThrow(); });
  it("throws INVALID_ACHIEVEMENT for negative", () => {
    expect(() => assertAchievementValid(-1n)).toThrow(DomainError);
    try { assertAchievementValid(-1n); } catch (e) { expect((e as DomainError).code).toBe("INVALID_ACHIEVEMENT"); }
  });
});

describe("assertEvaluatorDistinct (maker-checker)", () => {
  it("passes for different officers", () => {
    expect(() => assertEvaluatorDistinct("user-a", "user-b")).not.toThrow();
  });

  it("throws MAKER_CHECKER_VIOLATION for same officer", () => {
    expect(() => assertEvaluatorDistinct("user-a", "user-a")).toThrow(DomainError);
  });
});
