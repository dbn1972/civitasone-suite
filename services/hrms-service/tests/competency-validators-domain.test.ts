/**
 * HRMS Pack #28 — Competency: validators + domain logic.
 *
 * Source: modules/competency/validators.ts, modules/competency/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  createFrameworkBody,
  createCompetencyBody,
  roleRequirementBody,
  setEmployeeCompetencyBody,
} from "../src/modules/competency/validators.js";
import {
  analyzeGaps,
  resolveCertifiedLevel,
  mergeLevel,
  type RequiredCompetency,
} from "../src/modules/competency/domain.js";

// ═══ Validators ═══

describe("createFrameworkBody", () => {
  it("accepts valid framework", () => {
    expect(createFrameworkBody.safeParse({ name: "Leadership" }).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(createFrameworkBody.safeParse({ name: "" }).success).toBe(false);
  });
  it("rejects name exceeding 256 chars", () => {
    expect(createFrameworkBody.safeParse({ name: "x".repeat(257) }).success).toBe(false);
  });
  it("rejects description exceeding 2000", () => {
    expect(createFrameworkBody.safeParse({ name: "X", description: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("createCompetencyBody", () => {
  const valid = { code: "LEAD-01", name: "Strategic Thinking" };
  it("accepts valid competency", () => {
    expect(createCompetencyBody.safeParse(valid).success).toBe(true);
  });
  it("rejects empty code", () => {
    expect(createCompetencyBody.safeParse({ ...valid, code: "" }).success).toBe(false);
  });
  it("rejects code exceeding 48 chars", () => {
    expect(createCompetencyBody.safeParse({ ...valid, code: "x".repeat(49) }).success).toBe(false);
  });
  it("rejects maxLevel below 1 or above 10", () => {
    expect(createCompetencyBody.safeParse({ ...valid, maxLevel: 0 }).success).toBe(false);
    expect(createCompetencyBody.safeParse({ ...valid, maxLevel: 11 }).success).toBe(false);
  });
  it("defaults maxLevel=5, certifiedLevel=3, category=general", () => {
    const result = createCompetencyBody.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxLevel).toBe(5);
      expect(result.data.certifiedLevel).toBe(3);
      expect(result.data.category).toBe("general");
    }
  });
});

describe("roleRequirementBody", () => {
  it("accepts valid requirement", () => {
    expect(roleRequirementBody.safeParse({
      roleCode: "senior-dev", competencyId: "10000000-aaaa-4000-8000-000000000001", requiredLevel: 4,
    }).success).toBe(true);
  });
  it("rejects non-UUID competencyId", () => {
    expect(roleRequirementBody.safeParse({ roleCode: "x", competencyId: "bad", requiredLevel: 3 }).success).toBe(false);
  });
  it("rejects requiredLevel outside 1-10", () => {
    expect(roleRequirementBody.safeParse({ roleCode: "x", competencyId: "10000000-aaaa-4000-8000-000000000001", requiredLevel: 0 }).success).toBe(false);
    expect(roleRequirementBody.safeParse({ roleCode: "x", competencyId: "10000000-aaaa-4000-8000-000000000001", requiredLevel: 11 }).success).toBe(false);
  });
});

describe("setEmployeeCompetencyBody", () => {
  it("accepts valid entry", () => {
    expect(setEmployeeCompetencyBody.safeParse({
      competencyId: "10000000-aaaa-4000-8000-000000000001", currentLevel: 3,
    }).success).toBe(true);
  });
  it("accepts level 0 (no proficiency)", () => {
    expect(setEmployeeCompetencyBody.safeParse({
      competencyId: "10000000-aaaa-4000-8000-000000000001", currentLevel: 0,
    }).success).toBe(true);
  });
  it("rejects level above 10", () => {
    expect(setEmployeeCompetencyBody.safeParse({
      competencyId: "10000000-aaaa-4000-8000-000000000001", currentLevel: 11,
    }).success).toBe(false);
  });
  it("rejects invalid source enum", () => {
    expect(setEmployeeCompetencyBody.safeParse({
      competencyId: "10000000-aaaa-4000-8000-000000000001", currentLevel: 2, source: "guess",
    }).success).toBe(false);
  });
  it("accepts all valid sources", () => {
    for (const s of ["manual", "assessment", "training"]) {
      expect(setEmployeeCompetencyBody.safeParse({
        competencyId: "10000000-aaaa-4000-8000-000000000001", currentLevel: 2, source: s,
      }).success).toBe(true);
    }
  });
});

// ═══ Domain Logic ═══

describe("analyzeGaps — competency gap analysis", () => {
  const required: RequiredCompetency[] = [
    { competencyId: "a", requiredLevel: 4 },
    { competencyId: "b", requiredLevel: 3 },
    { competencyId: "c", requiredLevel: 5 },
  ];

  it("all met when held >= required for every competency", () => {
    const held = new Map([["a", 5], ["b", 3], ["c", 5]]);
    const result = analyzeGaps(required, held);
    expect(result.metCount).toBe(3);
    expect(result.gapCount).toBe(0);
    expect(result.readinessPct).toBe(100);
  });

  it("identifies gaps where held < required", () => {
    const held = new Map([["a", 2], ["b", 3], ["c", 1]]);
    const result = analyzeGaps(required, held);
    expect(result.metCount).toBe(1); // only "b" is met
    expect(result.gapCount).toBe(2);
    expect(result.rows.find(r => r.competencyId === "a")?.gap).toBe(2); // 4-2
    expect(result.rows.find(r => r.competencyId === "c")?.gap).toBe(4); // 5-1
  });

  it("missing held competency counts as level 0", () => {
    const held = new Map<string, number>(); // empty
    const result = analyzeGaps(required, held);
    expect(result.gapCount).toBe(3);
    expect(result.rows[0]?.heldLevel).toBe(0);
  });

  it("readinessPct rounds correctly", () => {
    // 1/3 met = 33.33% rounds to 33
    const held = new Map([["a", 5]]);
    const result = analyzeGaps(required, held);
    expect(result.readinessPct).toBe(33);
  });

  it("empty required list gives 100% readiness", () => {
    const result = analyzeGaps([], new Map());
    expect(result.readinessPct).toBe(100);
    expect(result.requiredCount).toBe(0);
  });
});

describe("resolveCertifiedLevel", () => {
  it("returns certifiedLevel when within maxLevel", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 3, maxLevel: 5 })).toBe(3);
  });
  it("caps at maxLevel when certifiedLevel exceeds it", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 7, maxLevel: 5 })).toBe(5);
  });
  it("equal values return that value", () => {
    expect(resolveCertifiedLevel({ certifiedLevel: 5, maxLevel: 5 })).toBe(5);
  });
});

describe("mergeLevel — never regress", () => {
  it("takes incoming when higher", () => {
    expect(mergeLevel(2, 4)).toBe(4);
  });
  it("keeps current when higher", () => {
    expect(mergeLevel(5, 3)).toBe(5);
  });
  it("equal returns same", () => {
    expect(mergeLevel(3, 3)).toBe(3);
  });
  it("zero current takes incoming", () => {
    expect(mergeLevel(0, 2)).toBe(2);
  });
});
