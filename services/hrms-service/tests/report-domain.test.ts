import { describe, it, expect } from "vitest";
import {
  attendanceStats, cutoffStats, scoreDistribution, itemAnalysis,
  type AttemptStat, type QuestionResponse,
} from "../src/modules/recruitment/report-domain.js";

const A = (over: Partial<AttemptStat> = {}): AttemptStat => ({ status: "evaluated", result: "qualified", ...over });

describe("attendanceStats", () => {
  it("counts assigned-as-absent, in-progress, evaluated and voided", () => {
    const r = attendanceStats([
      A({ status: "assigned" }), A({ status: "in_progress" }), A({ status: "evaluated" }),
      A({ status: "expired" }), A({ status: "void" }),
    ]);
    expect(r).toEqual({ total: 5, assigned: 1, inProgress: 1, evaluated: 1, absent: 2, voided: 1 });
  });
});

describe("cutoffStats", () => {
  it("tallies results and ignores void attempts", () => {
    const r = cutoffStats([
      A({ result: "qualified" }), A({ result: "not_qualified" }), A({ result: "withheld" }),
      A({ result: "pending" }), A({ status: "void", result: "qualified" }),
    ]);
    expect(r).toEqual({ qualified: 1, notQualified: 1, withheld: 1, pending: 1 });
  });
});

describe("scoreDistribution", () => {
  it("buckets percentage scores; 100% lands in the top band; void excluded", () => {
    const d = scoreDistribution([
      A({ totalScore: 10, maxScore: 100 }),  // 10% -> 0-20
      A({ totalScore: 50, maxScore: 100 }),  // 50% -> 40-60
      A({ totalScore: 100, maxScore: 100 }), // 100% -> 80-100 (top, inclusive)
      A({ status: "void", totalScore: 90, maxScore: 100 }),
    ], 20);
    expect(d).toHaveLength(5);
    expect(d[0]!.count).toBe(1);  // 0-20
    expect(d[2]!.count).toBe(1);  // 40-60
    expect(d[4]!.count).toBe(1);  // 80-100 (the 100%)
  });
  it("skips attempts with no/zero max", () => {
    const d = scoreDistribution([A({ totalScore: 5, maxScore: 0 }), A({ totalScore: null, maxScore: 100 })], 25);
    expect(d.reduce((s, b) => s + b.count, 0)).toBe(0);
  });
});

describe("itemAnalysis", () => {
  const paper = [
    { questionId: "q1", section: "s", marks: 10, qtype: "mcq" },
    { questionId: "q2", section: "s", marks: 20, qtype: "descriptive" },
  ];
  it("computes difficulty index for objective and null for manual", () => {
    const byQ = new Map<string, QuestionResponse[]>([
      ["q1", [
        { questionId: "q1", isCorrect: true, score: 10 },
        { questionId: "q1", isCorrect: false, score: 0 },
        { questionId: "q1", isCorrect: true, score: 10 },
      ]],
      ["q2", [
        { questionId: "q2", isCorrect: null, score: 15 },
        { questionId: "q2", isCorrect: null, score: 5 },
      ]],
    ]);
    const items = itemAnalysis(paper, byQ);
    expect(items[0]).toMatchObject({ questionId: "q1", attempted: 3, correct: 2, difficultyIndex: 0.67, avgScore: 6.67 });
    expect(items[1]).toMatchObject({ questionId: "q2", attempted: 2, correct: 0, difficultyIndex: null, avgScore: 10 });
  });
  it("returns nulls for a question nobody answered", () => {
    const items = itemAnalysis(paper, new Map());
    expect(items[0]).toMatchObject({ attempted: 0, difficultyIndex: null, avgScore: null });
  });
});
