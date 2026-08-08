/**
 * HRMS Competency — gap analysis and level merge tests.
 * Pack #28. Source: modules/competency/domain.ts
 */
import { describe, it, expect } from "vitest";
import { analyzeGaps, resolveCertifiedLevel, mergeLevel } from "../src/modules/competency/domain.js";

describe("analyzeGaps", () => {
  it("all met → 100% readiness", () => {
    const required = [{ competencyId: "c1", requiredLevel: 3 }, { competencyId: "c2", requiredLevel: 2 }];
    const held = new Map([["c1", 4], ["c2", 2]]);
    const result = analyzeGaps(required, held);
    expect(result.readinessPct).toBe(100);
    expect(result.gapCount).toBe(0);
    expect(result.metCount).toBe(2);
  });

  it("partial gaps → correct percentage", () => {
    const required = [{ competencyId: "c1", requiredLevel: 5 }, { competencyId: "c2", requiredLevel: 3 }, { competencyId: "c3", requiredLevel: 2 }];
    const held = new Map([["c1", 3], ["c2", 3], ["c3", 4]]);
    const result = analyzeGaps(required, held);
    expect(result.metCount).toBe(2); // c2 and c3 met
    expect(result.gapCount).toBe(1); // c1 not met
    expect(result.readinessPct).toBe(67); // 2/3 = 66.67 → 67
  });

  it("missing competency → level 0 → gap", () => {
    const required = [{ competencyId: "c1", requiredLevel: 1 }];
    const held = new Map<string, number>(); // nothing held
    const result = analyzeGaps(required, held);
    expect(result.rows[0]!.heldLevel).toBe(0);
    expect(result.rows[0]!.gap).toBe(1);
    expect(result.rows[0]!.met).toBe(false);
  });

  it("empty required → 100% readiness", () => {
    expect(analyzeGaps([], new Map()).readinessPct).toBe(100);
  });

  it("gap = max(0, required - held)", () => {
    const required = [{ competencyId: "c1", requiredLevel: 5 }];
    const held = new Map([["c1", 7]]); // over-qualified
    const result = analyzeGaps(required, held);
    expect(result.rows[0]!.gap).toBe(0);
    expect(result.rows[0]!.met).toBe(true);
  });
});

describe("resolveCertifiedLevel", () => {
  it("returns certifiedLevel when <= maxLevel", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 3, maxLevel: 5 })).toBe(3);
  });
  it("caps at maxLevel", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 7, maxLevel: 5 })).toBe(5);
  });
});

describe("mergeLevel — never regress", () => {
  it("takes higher of current and incoming", () => {
    expect(mergeLevel(3, 5)).toBe(5);
    expect(mergeLevel(5, 3)).toBe(5);
    expect(mergeLevel(4, 4)).toBe(4);
  });
});
