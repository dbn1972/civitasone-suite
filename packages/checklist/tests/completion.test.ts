import { describe, it, expect } from "vitest";
import {
  computeProgressPercent,
  evaluateCompletion,
  findUnansweredRequired,
  isComplete,
} from "../src/completion.js";
import { answers, question, section } from "./fixtures.js";

describe("evaluateCompletion", () => {
  it("reports an empty checklist as complete at 100%", () => {
    const state = evaluateCompletion([], {});
    expect(state.complete).toBe(true);
    expect(state.progressPercent).toBe(100);
    expect(state.requiredTotal).toBe(0);
    expect(state.unansweredRequired).toEqual([]);
  });

  it("lists outstanding required questions with their section and prompt", () => {
    const sections = [section("s1", [question("q1"), question("q2")])];
    const state = evaluateCompletion(sections, answers({ q1: "a" }));
    expect(state.complete).toBe(false);
    expect(state.unansweredRequired).toEqual(["q2"]);
    expect(state.outstanding).toEqual([{ questionId: "q2", sectionId: "s1", text: "Question q2" }]);
    expect(state.requiredTotal).toBe(2);
    expect(state.requiredAnswered).toBe(1);
    expect(state.progressPercent).toBe(50);
  });

  it("never demands an answer to an optional question", () => {
    const sections = [section("s1", [question("q1", { required: false })])];
    const state = evaluateCompletion(sections, {});
    expect(state.complete).toBe(true);
    expect(state.requiredTotal).toBe(0);
  });

  it("never demands an answer to a hidden required question", () => {
    const sections = [
      section("s1", [
        question("q1"),
        question("q2", {
          conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: "yes", action: "show" }],
        }),
      ]),
    ];
    const hidden = evaluateCompletion(sections, answers({ q1: "no" }));
    expect(hidden.complete).toBe(true);
    expect(hidden.requiredTotal).toBe(1);

    const revealed = evaluateCompletion(sections, answers({ q1: "yes" }));
    expect(revealed.complete).toBe(false);
    expect(revealed.unansweredRequired).toEqual(["q2"]);
  });

  it("never demands an answer inside a section still locked by a prerequisite", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [question("q2")], {
        sortOrder: 2,
        prerequisite: { sectionId: "s1", minScore: 100 },
      }),
    ];
    const locked = evaluateCompletion(sections, {});
    expect(locked.lockedSectionIds).toEqual(["s2"]);
    expect(locked.availableSectionIds).toEqual(["s1"]);
    expect(locked.unansweredRequired).toEqual(["q1"]);

    const unlocked = evaluateCompletion(sections, answers({ q1: "a" }));
    expect(unlocked.lockedSectionIds).toEqual([]);
    expect(unlocked.unansweredRequired).toEqual(["q2"]);
    expect(unlocked.complete).toBe(false);
  });

  it("is complete only once every visible required question in every open section is answered", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [question("q2")], {
        sortOrder: 2,
        prerequisite: { sectionId: "s1", minScore: 100 },
      }),
    ];
    const state = evaluateCompletion(sections, answers({ q1: "a", q2: "b" }));
    expect(state.complete).toBe(true);
    expect(state.progressPercent).toBe(100);
    expect(state.score).toBe(100);
  });

  it("carries the section scores and weighted overall score alongside progress", () => {
    const sections = [
      section("s1", [question("q1", { weight: 3 }), question("q2", { weight: 1 })], { weight: 2 }),
      section("s2", [question("q3")], { weight: 1, sortOrder: 2 }),
    ];
    const state = evaluateCompletion(sections, answers({ q1: "a" }));
    expect(state.sectionScores).toEqual({ s1: 75, s2: 0 });
    expect(state.score).toBe(50);
    expect(state.progressPercent).toBe(33);
  });

  it("does not count a blank answer as progress", () => {
    const sections = [section("s1", [question("q1")])];
    const state = evaluateCompletion(sections, answers({ q1: "   " }));
    expect(state.complete).toBe(false);
    expect(state.progressPercent).toBe(0);
  });
});

describe("thin wrappers", () => {
  const sections = [section("s1", [question("q1"), question("q2")])];

  it("findUnansweredRequired returns just the ids", () => {
    expect(findUnansweredRequired(sections, answers({ q1: "a" }))).toEqual(["q2"]);
  });

  it("isComplete agrees with evaluateCompletion", () => {
    expect(isComplete(sections, {})).toBe(false);
    expect(isComplete(sections, answers({ q1: "a", q2: "b" }))).toBe(true);
  });

  it("computeProgressPercent agrees with evaluateCompletion", () => {
    expect(computeProgressPercent(sections, {})).toBe(0);
    expect(computeProgressPercent(sections, answers({ q1: "a" }))).toBe(50);
  });
});
