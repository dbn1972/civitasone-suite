/** LQ-001 pure qualification scoring domain tests. */
import { describe, it, expect } from "vitest";
import {
  scoreAnswer,
  outcomeFromScore,
  computeQualification,
  type QualificationQuestion,
} from "../src/modules/leads/qualification-domain.js";

const boolQ = (id: string, weight: number, whenTrue = 100, whenFalse = 0): QualificationQuestion =>
  ({ id, answerType: "bool", weight, outcomeRule: { whenTrue, whenFalse } });
const selectQ = (id: string, weight: number, options: Record<string, number>, dflt = 0): QualificationQuestion =>
  ({ id, answerType: "select", weight, outcomeRule: { options, default: dflt } });
const numberQ = (id: string, weight: number, tiers: Array<{ min: number; score: number }>, dflt = 0): QualificationQuestion =>
  ({ id, answerType: "number", weight, outcomeRule: { tiers, default: dflt } });

describe("scoreAnswer — bool", () => {
  const q = boolQ("q1", 100, 100, 20);
  it("true → whenTrue", () => expect(scoreAnswer(q, true)).toBe(100));
  it("string 'true' → whenTrue", () => expect(scoreAnswer(q, "true")).toBe(100));
  it("1 → whenTrue", () => expect(scoreAnswer(q, 1)).toBe(100));
  it("false → whenFalse", () => expect(scoreAnswer(q, false)).toBe(20));
  it("missing → whenFalse", () => expect(scoreAnswer(q, undefined)).toBe(20));
  it("clamps out-of-range rule values", () =>
    expect(scoreAnswer(boolQ("q", 100, 999, -5), true)).toBe(100));
});

describe("scoreAnswer — select", () => {
  const q = selectQ("q2", 100, { referral: 90, website: 60 }, 10);
  it("known option", () => expect(scoreAnswer(q, "referral")).toBe(90));
  it("another known option", () => expect(scoreAnswer(q, "website")).toBe(60));
  it("unknown option → default", () => expect(scoreAnswer(q, "carrier_pigeon")).toBe(10));
  it("null → default", () => expect(scoreAnswer(q, null)).toBe(10));
});

describe("scoreAnswer — number", () => {
  const q = numberQ("q3", 100, [{ min: 0, score: 10 }, { min: 100, score: 60 }, { min: 1000, score: 100 }], 0);
  it("picks the highest tier whose min is met", () => expect(scoreAnswer(q, 500)).toBe(60));
  it("lowest tier", () => expect(scoreAnswer(q, 50)).toBe(10));
  it("top tier", () => expect(scoreAnswer(q, 5000)).toBe(100));
  it("missing → default", () => expect(scoreAnswer(q, null)).toBe(0));
  it("empty string → default", () => expect(scoreAnswer(q, "")).toBe(0));
  it("non-numeric → default", () => expect(scoreAnswer(q, "abc")).toBe(0));
});

describe("scoreAnswer — unknown type", () => {
  it("returns 0", () =>
    expect(scoreAnswer({ id: "x", answerType: "weird" as never, weight: 1, outcomeRule: {} }, "y")).toBe(0));
});

describe("outcomeFromScore", () => {
  it("qualified at/above 70", () => {
    expect(outcomeFromScore(70)).toBe("qualified");
    expect(outcomeFromScore(100)).toBe("qualified");
  });
  it("nurture in [40,70)", () => {
    expect(outcomeFromScore(40)).toBe("nurture");
    expect(outcomeFromScore(69)).toBe("nurture");
  });
  it("disqualified below 40", () => {
    expect(outcomeFromScore(39)).toBe("disqualified");
    expect(outcomeFromScore(0)).toBe("disqualified");
  });
});

describe("computeQualification", () => {
  it("weights answers and normalises to 0-100", () => {
    const questions = [boolQ("a", 60, 100, 0), selectQ("b", 40, { x: 50 }, 0)];
    const res = computeQualification(questions, { a: true, b: "x" });
    // (60*100 + 40*50)/100 = 80
    expect(res.score).toBe(80);
    expect(res.outcome).toBe("qualified");
    expect(res.factors).toEqual({ a: 100, b: 50 });
  });

  it("no questions → 0 / disqualified", () => {
    const res = computeQualification([], {});
    expect(res.score).toBe(0);
    expect(res.outcome).toBe("disqualified");
  });

  it("all-zero weights → 0 (no divide-by-zero)", () => {
    const res = computeQualification([boolQ("a", 0), boolQ("b", 0)], { a: true, b: true });
    expect(res.score).toBe(0);
    expect(res.outcome).toBe("disqualified");
  });

  it("a mid outcome lands in nurture", () => {
    const res = computeQualification([boolQ("a", 100, 50, 50)], { a: true });
    expect(res.score).toBe(50);
    expect(res.outcome).toBe("nurture");
  });

  it("missing answers score as their whenFalse/default", () => {
    const res = computeQualification([boolQ("a", 100, 100, 0)], {});
    expect(res.score).toBe(0);
  });
});
