/**
 * SVC-040 — outcome/output budgeting pure domain tests.
 * No DB, no I/O.
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

const base = { targetValue: 1000n, baselineValue: 0n };

describe("outcome-domain — achievementRatioBps()", () => {
  it("returns 0 when nothing achieved", () => {
    expect(achievementRatioBps(base, 0n)).toBe(0n);
  });
  it("returns 5000 bps at half the target", () => {
    expect(achievementRatioBps(base, 500n)).toBe(5000n);
  });
  it("returns 10000 bps at the target", () => {
    expect(achievementRatioBps(base, 1000n)).toBe(10000n);
  });
  it("clamps at 10000 bps beyond the target", () => {
    expect(achievementRatioBps(base, 5000n)).toBe(10000n);
  });
  it("nets out the baseline", () => {
    // span 1000..2000 = 1000; achieved 1500 → 500/1000 = 5000bps
    expect(achievementRatioBps({ targetValue: 2000n, baselineValue: 1000n }, 1500n)).toBe(5000n);
  });
  it("reads negative progress as 0", () => {
    expect(achievementRatioBps({ targetValue: 2000n, baselineValue: 1000n }, 500n)).toBe(0n);
  });
  it("returns full when target equals baseline (degenerate span)", () => {
    expect(achievementRatioBps({ targetValue: 1000n, baselineValue: 1000n }, 0n)).toBe(10000n);
  });
});

describe("outcome-domain — classifyAchievement()", () => {
  it("achieved at >= 100%", () => {
    expect(classifyAchievement(base, 1000n)).toBe("achieved");
    expect(classifyAchievement(base, 1200n)).toBe("achieved");
  });
  it("on_track at >= 75%", () => {
    expect(classifyAchievement(base, 750n)).toBe("on_track");
    expect(classifyAchievement(base, 999n)).toBe("on_track");
  });
  it("at_risk at >= 50%", () => {
    expect(classifyAchievement(base, 500n)).toBe("at_risk");
    expect(classifyAchievement(base, 749n)).toBe("at_risk");
  });
  it("not_achieved below 50%", () => {
    expect(classifyAchievement(base, 499n)).toBe("not_achieved");
    expect(classifyAchievement(base, 0n)).toBe("not_achieved");
  });
});

describe("outcome-domain — assertOutcomeLinkageValid()", () => {
  const ok = { indicator: "km of road", unit: "km", targetValue: 1000n, baselineValue: 0n, allocatedMinor: 500000n };
  it("passes a coherent linkage", () => {
    expect(() => assertOutcomeLinkageValid(ok)).not.toThrow();
  });
  it("rejects empty indicator", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, indicator: "  " })).toThrow(DomainError);
  });
  it("rejects empty unit", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, unit: "" })).toThrow(DomainError);
  });
  it("rejects non-positive target", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, targetValue: 0n })).toThrow(/INVALID_OUTCOME/);
  });
  it("rejects negative baseline", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, baselineValue: -1n })).toThrow(DomainError);
  });
  it("rejects baseline >= target", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, baselineValue: 1000n })).toThrow(/INVALID_OUTCOME/);
  });
  it("rejects negative allocation", () => {
    expect(() => assertOutcomeLinkageValid({ ...ok, allocatedMinor: -5n })).toThrow(DomainError);
  });
});

describe("outcome-domain — assertAchievementValid()", () => {
  it("passes for zero and positive", () => {
    expect(() => assertAchievementValid(0n)).not.toThrow();
    expect(() => assertAchievementValid(42n)).not.toThrow();
  });
  it("throws for negative", () => {
    expect(() => assertAchievementValid(-1n)).toThrow(/INVALID_ACHIEVEMENT/);
  });
});

describe("outcome-domain — assertEvaluatorDistinct() (maker-checker)", () => {
  it("passes for distinct officers", () => {
    expect(() => assertEvaluatorDistinct("maker", "checker")).not.toThrow();
  });
  it("throws MAKER_CHECKER_VIOLATION for self-evaluation", () => {
    expect(() => assertEvaluatorDistinct("same", "same")).toThrow(/MAKER_CHECKER_VIOLATION/);
    try { assertEvaluatorDistinct("x", "x"); } catch (e) {
      expect((e as DomainError).code).toBe("MAKER_CHECKER_VIOLATION");
    }
  });
});
