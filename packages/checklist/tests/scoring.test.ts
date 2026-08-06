import { describe, it, expect } from "vitest";
import { computeScores, computeSectionScore, computeSectionScores } from "../src/scoring.js";
import { answers, question, section } from "./fixtures.js";

describe("computeSectionScore", () => {
  it("scores 100 when a section has no required questions", () => {
    const s = section("s1", [question("q1", { required: false })]);
    expect(computeSectionScore(s, {})).toBe(100);
  });

  it("scores 100 for a section with no questions at all", () => {
    expect(computeSectionScore(section("s1", []), {})).toBe(100);
  });

  it("weights required questions by their weight", () => {
    const s = section("s1", [
      question("q1", { weight: 3 }),
      question("q2", { weight: 1 }),
    ]);
    expect(computeSectionScore(s, {})).toBe(0);
    expect(computeSectionScore(s, answers({ q1: "a" }))).toBe(75);
    expect(computeSectionScore(s, answers({ q2: "a" }))).toBe(25);
    expect(computeSectionScore(s, answers({ q1: "a", q2: "b" }))).toBe(100);
  });

  it("ignores optional questions even when answered", () => {
    const s = section("s1", [question("q1"), question("q2", { required: false })]);
    expect(computeSectionScore(s, answers({ q2: "a" }))).toBe(0);
  });

  it("excludes hidden required questions from the denominator", () => {
    const s = section("s1", [
      question("q1"),
      question("q2", {
        conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: "yes", action: "show" }],
      }),
    ]);
    // q2 hidden: q1 is the only obligation, so answering it scores 100.
    expect(computeSectionScore(s, answers({ q1: "no" }))).toBe(100);
    // q1 = yes reveals q2, which halves the score again.
    expect(computeSectionScore(s, answers({ q1: "yes" }))).toBe(50);
  });

  it("falls back to an unweighted count when every weight is zero", () => {
    const s = section("s1", [
      question("q1", { weight: 0 }),
      question("q2", { weight: 0 }),
    ]);
    expect(computeSectionScore(s, answers({ q1: "a" }))).toBe(50);
  });

  it("rounds to the nearest integer", () => {
    const s = section("s1", [question("q1"), question("q2"), question("q3")]);
    expect(computeSectionScore(s, answers({ q1: "a" }))).toBe(33);
    expect(computeSectionScore(s, answers({ q1: "a", q2: "b" }))).toBe(67);
  });
});

describe("computeScores", () => {
  it("averages section scores by section weight", () => {
    const sections = [
      section("s1", [question("q1")], { weight: 3 }),
      section("s2", [question("q2")], { weight: 1, sortOrder: 2 }),
    ];
    const result = computeScores(sections, answers({ q1: "a" }));
    expect(result.sectionScores).toEqual({ s1: 100, s2: 0 });
    expect(result.overallScore).toBe(75);
  });

  it("returns 0 overall for an empty structure", () => {
    expect(computeScores([], {})).toEqual({
      sectionScores: {},
      overallScore: 0,
      availability: {},
    });
  });

  it("falls back to a plain average when every section weight is zero", () => {
    const sections = [
      section("s1", [question("q1")], { weight: 0 }),
      section("s2", [question("q2")], { weight: 0, sortOrder: 2 }),
    ];
    expect(computeScores(sections, answers({ q1: "a" })).overallScore).toBe(50);
  });

  it("excludes sections still locked behind a prerequisite from the overall score", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [question("q2")], {
        sortOrder: 2,
        prerequisite: { sectionId: "s1", minScore: 100 },
      }),
    ];
    // s1 unanswered → s2 locked → overall reflects s1 alone.
    const locked = computeScores(sections, {});
    expect(locked.availability).toEqual({ s1: true, s2: false });
    expect(locked.overallScore).toBe(0);

    // s1 complete → s2 unlocks and starts pulling the overall down.
    const unlocked = computeScores(sections, answers({ q1: "a" }));
    expect(unlocked.availability).toEqual({ s1: true, s2: true });
    expect(unlocked.overallScore).toBe(50);
  });

  it("computeSectionScores covers every section id", () => {
    const sections = [section("s1", [question("q1")]), section("s2", [], { sortOrder: 2 })];
    expect(computeSectionScores(sections, {})).toEqual({ s1: 0, s2: 100 });
  });
});
