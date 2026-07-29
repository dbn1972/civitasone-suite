import { describe, it, expect } from "vitest";
import {
  randomizeQuestionOrder, effectiveDurationMs, attemptDeadline, scoreObjective, computeAttemptResult,
  type PaperEntry, type ObjectiveScore,
} from "../src/modules/recruitment/attempt-domain.js";

describe("randomizeQuestionOrder", () => {
  const ids = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];
  it("is deterministic for the same seed (recovery-stable)", () => {
    expect(randomizeQuestionOrder(ids, "attempt-A")).toEqual(randomizeQuestionOrder(ids, "attempt-A"));
  });
  it("differs between candidates (different seeds)", () => {
    expect(randomizeQuestionOrder(ids, "attempt-A")).not.toEqual(randomizeQuestionOrder(ids, "attempt-B"));
  });
  it("is a permutation (same set, no loss/dup) and does not mutate input", () => {
    const copy = [...ids];
    const out = randomizeQuestionOrder(ids, "seed");
    expect([...out].sort()).toEqual([...ids].sort());
    expect(ids).toEqual(copy);
  });
});

describe("accommodation timing", () => {
  it("adds extra time as a percentage of duration", () => {
    expect(effectiveDurationMs(60, 0)).toBe(60 * 60_000);
    expect(effectiveDurationMs(60, 50)).toBe(90 * 60_000); // +50%
  });
  it("computes the personal deadline from start + effective duration", () => {
    const start = 1_000_000;
    expect(attemptDeadline(start, 60, 25)).toBe(start + 75 * 60_000);
  });
  it("caps the deadline to the window end plus only the granted extra time", () => {
    const start = 0;
    const windowEnd = 30 * 60_000; // window closes 30 min after start
    // 60-min duration would run to 60 min, but window+extra caps it.
    expect(attemptDeadline(start, 60, 0, windowEnd)).toBe(windowEnd);          // no accommodation -> capped at window end
    expect(attemptDeadline(start, 60, 50, windowEnd)).toBe(windowEnd + 30 * 60_000); // +50% of 60min = 30min extra beyond window
  });
});

describe("scoreObjective", () => {
  const mcq = (over: Partial<PaperEntry> = {}): PaperEntry => ({ questionId: "q", section: "s", marks: 4, qtype: "mcq", answerKey: { correct: ["b"] }, ...over });
  it("awards full marks for an exact MCQ match", () => {
    expect(scoreObjective(mcq(), { selected: ["b"] }, { enabled: false })).toEqual({ score: 4, isCorrect: true, auto: true });
  });
  it("applies negative marking for a wrong MCQ answer when enabled", () => {
    expect(scoreObjective(mcq(), { selected: ["a"] }, { enabled: true, fraction: 0.25 })).toEqual({ score: -1, isCorrect: false, auto: true });
  });
  it("no penalty for a blank MCQ answer", () => {
    expect(scoreObjective(mcq(), { selected: [] }, { enabled: true, fraction: 0.25 })).toEqual({ score: 0, isCorrect: false, auto: true });
  });
  it("requires an exact set for multi-correct MCQ", () => {
    const q = mcq({ answerKey: { correct: ["a", "c"] } });
    expect(scoreObjective(q, { selected: ["a"] }, { enabled: false }).isCorrect).toBe(false);
    expect(scoreObjective(q, { selected: ["c", "a"] }, { enabled: false }).isCorrect).toBe(true);
  });
  it("cannot be gamed by padding a single answer with duplicates", () => {
    // ["a","a","a"] must NOT match correct ["a","b","c"] — true-set comparison.
    const q = mcq({ answerKey: { correct: ["a", "b", "c"] }, marks: 3 });
    expect(scoreObjective(q, { selected: ["a", "a", "a"] }, { enabled: false }).isCorrect).toBe(false);
  });
  it("does NOT auto-score coding — held for trusted-runner/manual evaluation (auto=false)", () => {
    const q: PaperEntry = { questionId: "q", section: "s", marks: 10, qtype: "coding", answerKey: { testCasesRef: "tc" } };
    // even a client claiming a perfect run must not be auto-credited
    expect(scoreObjective(q, { passed: 10, total: 10 }, undefined)).toEqual({ score: 0, isCorrect: null, auto: false });
  });
  it("marks descriptive/file_upload for manual evaluation (auto=false)", () => {
    expect(scoreObjective({ questionId: "q", section: "s", marks: 10, qtype: "descriptive" }, { text: "essay" }, undefined)).toEqual({ score: 0, isCorrect: null, auto: false });
  });
});

describe("computeAttemptResult", () => {
  const paper: PaperEntry[] = [
    { questionId: "a1", section: "apt", marks: 5, qtype: "mcq" },
    { questionId: "a2", section: "apt", marks: 5, qtype: "mcq" },
    { questionId: "d1", section: "dom", marks: 10, qtype: "mcq" },
  ];
  const scored = (m: Record<string, number>): Map<string, ObjectiveScore> =>
    new Map(Object.entries(m).map(([k, v]) => [k, { score: v, isCorrect: v > 0, auto: true }]));

  it("qualifies when total and section cut-offs are met", () => {
    const r = computeAttemptResult(paper, scored({ a1: 5, a2: 5, d1: 10 }), { totalCutoffPct: 40, sections: [{ key: "apt", sectionCutoffPct: 50 }] });
    expect(r.result).toBe("qualified");
    expect(r.totalScore).toBe(20);
    expect(r.maxScore).toBe(20);
    expect(r.sectionScores.apt).toEqual({ score: 10, max: 10 });
  });
  it("fails when a section cut-off is missed even if total passes", () => {
    // apt 0/10 (misses 50%), dom 10/10 -> total 10/20 = 50% passes total, but section fails
    const r = computeAttemptResult(paper, scored({ a1: 0, a2: 0, d1: 10 }), { totalCutoffPct: 40, sections: [{ key: "apt", sectionCutoffPct: 50 }] });
    expect(r.result).toBe("not_qualified");
  });
  it("withholds the result when any question needs manual evaluation", () => {
    const m = scored({ a1: 5, a2: 5 });
    m.set("d1", { score: 0, isCorrect: null, auto: false }); // manual
    const r = computeAttemptResult(paper, m, { totalCutoffPct: 40 });
    expect(r.result).toBe("withheld");
    expect(r.needsManualEval).toBe(true);
  });
});
