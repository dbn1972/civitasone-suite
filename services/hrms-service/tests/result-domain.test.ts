import { describe, it, expect } from "vitest";
import {
  aggregateEvaluations, consolidatedScores, validateModeration, applyModeration, resultAfterModeration,
  MODERATION_METHODS,
} from "../src/modules/recruitment/result-domain.js";
import type { PaperEntry, ObjectiveScore } from "../src/modules/recruitment/attempt-domain.js";

describe("aggregateEvaluations", () => {
  it("averages evaluator scores (2dp)", () => {
    expect(aggregateEvaluations([6, 7, 8])).toBe(7);
    expect(aggregateEvaluations([5, 6])).toBe(5.5);
    expect(aggregateEvaluations([])).toBe(0);
  });
});

describe("consolidatedScores", () => {
  const paper: PaperEntry[] = [
    { questionId: "m1", section: "s", marks: 10, qtype: "mcq" },
    { questionId: "d1", section: "s", marks: 20, qtype: "descriptive" },
  ];
  const obj = new Map<string, ObjectiveScore>([["m1", { score: 10, isCorrect: true, auto: true }]]);
  it("merges objective + manual when all manual questions are scored", () => {
    const { scored, missing } = consolidatedScores(paper, obj, new Map([["d1", 15]]));
    expect(missing).toEqual([]);
    expect(scored.get("d1")).toEqual({ score: 15, isCorrect: null, auto: true });
    expect(scored.get("m1")!.score).toBe(10);
  });
  it("reports manual questions that still need evaluation", () => {
    const { missing } = consolidatedScores(paper, obj, new Map());
    expect(missing).toEqual(["d1"]);
  });
});

describe("validateModeration", () => {
  it("accepts valid scale / grace / none", () => {
    expect(validateModeration({ method: "none" })).toEqual([]);
    expect(validateModeration({ method: "scale", factor: 1.1 })).toEqual([]);
    expect(validateModeration({ method: "grace", factor: 3 })).toEqual([]);
  });
  it("rejects a non-positive or excessive scale factor", () => {
    expect(validateModeration({ method: "scale", factor: 0 }).length).toBeGreaterThan(0);
    expect(validateModeration({ method: "scale", factor: 6 }).length).toBeGreaterThan(0);
  });
  it("rejects negative grace marks and unknown methods", () => {
    expect(validateModeration({ method: "grace", factor: -1 }).length).toBeGreaterThan(0);
    expect(validateModeration({ method: "curve" as never }).length).toBeGreaterThan(0);
  });
  it("exposes the method vocabulary", () => {
    expect(MODERATION_METHODS).toContain("scale");
  });
});

describe("applyModeration", () => {
  it("scales and clamps to max", () => {
    expect(applyModeration(40, 100, { method: "scale", factor: 1.25 })).toBe(50);
    expect(applyModeration(90, 100, { method: "scale", factor: 1.5 })).toBe(100); // clamped
  });
  it("adds grace marks, clamped", () => {
    expect(applyModeration(38, 100, { method: "grace", factor: 5 })).toBe(43);
    expect(applyModeration(98, 100, { method: "grace", factor: 5 })).toBe(100);
  });
  it("none leaves the score unchanged", () => {
    expect(applyModeration(37.5, 100, { method: "none" })).toBe(37.5);
  });
});

describe("resultAfterModeration", () => {
  const cutoffs = { totalCutoffPct: 40, sections: [{ key: "apt", sectionCutoffPct: 50 }] };
  it("qualifies when moderated total and sections pass", () => {
    const sections = { apt: { score: 6, max: 10 }, dom: { score: 30, max: 40 } };
    expect(resultAfterModeration(sections, cutoffs, 45, 50)).toBe("qualified");
  });
  it("stays not_qualified when a section cut-off is missed regardless of moderation", () => {
    const sections = { apt: { score: 4, max: 10 } }; // 40% < 50% section cut-off
    expect(resultAfterModeration(sections, cutoffs, 50, 50)).toBe("not_qualified");
  });
  it("not_qualified when moderated total is below the total cut-off", () => {
    const sections = { apt: { score: 6, max: 10 } };
    expect(resultAfterModeration(sections, cutoffs, 3, 10)).toBe("not_qualified"); // 30% < 40%
  });
});
