import { describe, it, expect } from "vitest";
import {
  evaluateConditionalRule,
  evaluateOperator,
  isQuestionVisible,
  resolveVisibility,
  visibleQuestions,
} from "../src/visibility.js";
import type { ConditionalRule } from "../src/types.js";
import { answers, question, section } from "./fixtures.js";

describe("evaluateOperator", () => {
  it("compares eq/neq strictly, with no coercion", () => {
    expect(evaluateOperator("eq", 1, 1)).toBe(true);
    expect(evaluateOperator("eq", "1", 1)).toBe(false);
    expect(evaluateOperator("neq", "1", 1)).toBe(true);
    expect(evaluateOperator("neq", "a", "a")).toBe(false);
  });

  it("compares gt/lt numerically", () => {
    expect(evaluateOperator("gt", 5, 3)).toBe(true);
    expect(evaluateOperator("gt", 3, 5)).toBe(false);
    expect(evaluateOperator("lt", 3, 5)).toBe(true);
    expect(evaluateOperator("lt", 5, 3)).toBe(false);
    expect(evaluateOperator("gt", "10", 3)).toBe(true);
  });

  it("returns false for gt/lt when either side is not numeric", () => {
    expect(evaluateOperator("gt", "abc", 1)).toBe(false);
    expect(evaluateOperator("lt", undefined, 1)).toBe(false);
  });

  it("handles in/not_in against arrays", () => {
    expect(evaluateOperator("in", "b", ["a", "b"])).toBe(true);
    expect(evaluateOperator("in", "c", ["a", "b"])).toBe(false);
    expect(evaluateOperator("not_in", "c", ["a", "b"])).toBe(true);
    expect(evaluateOperator("not_in", "a", ["a"])).toBe(false);
  });

  it("treats a non-array right-hand side as a non-membership", () => {
    expect(evaluateOperator("in", "a", "a")).toBe(false);
    expect(evaluateOperator("not_in", "a", "a")).toBe(false);
  });
});

describe("evaluateConditionalRule", () => {
  const show: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "show" };
  const hide: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "yes", action: "hide" };

  it("a show rule permits only when its condition matches", () => {
    expect(evaluateConditionalRule(show, answers({ q1: "yes" }))).toBe(true);
    expect(evaluateConditionalRule(show, answers({ q1: "no" }))).toBe(false);
    expect(evaluateConditionalRule(show, {})).toBe(false);
  });

  it("a hide rule permits only when its condition does NOT match", () => {
    expect(evaluateConditionalRule(hide, answers({ q1: "yes" }))).toBe(false);
    expect(evaluateConditionalRule(hide, answers({ q1: "no" }))).toBe(true);
    expect(evaluateConditionalRule(hide, {})).toBe(true);
  });

  it("reads the raw recorded value, so a blank answer can be tested for", () => {
    const blank: ConditionalRule = { dependsOn: "q1", operator: "eq", value: "", action: "show" };
    expect(evaluateConditionalRule(blank, answers({ q1: "" }))).toBe(true);
  });
});

describe("isQuestionVisible", () => {
  it("is visible with no rules and with an empty rule list", () => {
    expect(isQuestionVisible(question("q1"), {})).toBe(true);
    expect(isQuestionVisible(question("q1", { conditionalLogic: [] }), {})).toBe(true);
  });

  it("requires EVERY rule to permit (AND semantics)", () => {
    const q = question("q3", {
      conditionalLogic: [
        { dependsOn: "q1", operator: "eq", value: "yes", action: "show" },
        { dependsOn: "q2", operator: "gt", value: 100, action: "show" },
      ],
    });
    expect(isQuestionVisible(q, answers({ q1: "yes", q2: 500 }))).toBe(true);
    expect(isQuestionVisible(q, answers({ q1: "yes", q2: 50 }))).toBe(false);
    expect(isQuestionVisible(q, answers({ q1: "no", q2: 500 }))).toBe(false);
  });

  it("combines show and hide rules on one question", () => {
    const q = question("q3", {
      conditionalLogic: [
        { dependsOn: "q1", operator: "eq", value: "yes", action: "show" },
        { dependsOn: "q2", operator: "eq", value: "waived", action: "hide" },
      ],
    });
    expect(isQuestionVisible(q, answers({ q1: "yes" }))).toBe(true);
    expect(isQuestionVisible(q, answers({ q1: "yes", q2: "waived" }))).toBe(false);
  });
});

describe("resolveVisibility / visibleQuestions", () => {
  const s = section("s1", [
    question("q1"),
    question("q2", {
      conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: "yes", action: "show" }],
    }),
  ]);

  it("maps every question id to its visibility", () => {
    expect(resolveVisibility([s], {})).toEqual({ q1: true, q2: false });
    expect(resolveVisibility([s], answers({ q1: "yes" }))).toEqual({ q1: true, q2: true });
  });

  it("filters a section down to its visible questions", () => {
    expect(visibleQuestions(s, {}).map((q) => q.id)).toEqual(["q1"]);
    expect(visibleQuestions(s, answers({ q1: "yes" })).map((q) => q.id)).toEqual(["q1", "q2"]);
  });

  it("returns an empty map for an empty structure", () => {
    expect(resolveVisibility([], {})).toEqual({});
  });
});
