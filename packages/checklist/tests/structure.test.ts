import { describe, it, expect } from "vitest";
import {
  buildResponses,
  freezeStructure,
  mergeResponses,
  questionIds,
  unknownQuestionIds,
} from "../src/structure.js";
import { answers, AT, question, section } from "./fixtures.js";

describe("freezeStructure", () => {
  it("returns a copy that does not share state with the source", () => {
    const source = [section("s1", [question("q1")])];
    const frozen = freezeStructure(source);
    frozen[0]!.title = "changed";
    frozen[0]!.questions[0]!.text = "changed";
    expect(source[0]!.title).toBe("Section s1");
    expect(source[0]!.questions[0]!.text).toBe("Question q1");
  });

  it("orders sections and questions by sortOrder", () => {
    const source = [
      section("s2", [question("q3", { sortOrder: 2 }), question("q2", { sortOrder: 1 })], {
        sortOrder: 2,
      }),
      section("s1", [question("q1")], { sortOrder: 1 }),
    ];
    const frozen = freezeStructure(source);
    expect(frozen.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(frozen[1]!.questions.map((q) => q.id)).toEqual(["q2", "q3"]);
  });

  it("preserves conditional rules and prerequisites", () => {
    const source = [
      section("s1", [question("q1")]),
      section("s2", [
        question("q2", {
          conditionalLogic: [{ dependsOn: "q1", operator: "in", value: ["a"], action: "show" }],
        }),
      ], { sortOrder: 2, prerequisite: { sectionId: "s1", minScore: 60 } }),
    ];
    const frozen = freezeStructure(source);
    expect(frozen[1]!.prerequisite).toEqual({ sectionId: "s1", minScore: 60 });
    expect(frozen[1]!.questions[0]!.conditionalLogic?.[0]?.value).toEqual(["a"]);
  });

  it("handles an empty structure", () => {
    expect(freezeStructure([])).toEqual([]);
  });
});

describe("mergeResponses", () => {
  it("keeps untouched answers and overwrites resubmitted ones", () => {
    const existing = answers({ q1: "old", q2: "keep" });
    const incoming = { q1: { value: "new", answeredAt: "2026-02-02T00:00:00.000Z" } };
    const merged = mergeResponses(existing, incoming);
    expect(merged.q1).toEqual({ value: "new", answeredAt: "2026-02-02T00:00:00.000Z" });
    expect(merged.q2).toEqual({ value: "keep", answeredAt: AT });
  });

  it("does not mutate either input", () => {
    const existing = answers({ q1: "old" });
    const incoming = answers({ q2: "new" });
    mergeResponses(existing, incoming);
    expect(Object.keys(existing)).toEqual(["q1"]);
    expect(Object.keys(incoming)).toEqual(["q2"]);
  });

  it("returns the existing map unchanged when nothing is submitted", () => {
    const existing = answers({ q1: "old" });
    expect(mergeResponses(existing, {})).toEqual(existing);
  });
});

describe("buildResponses", () => {
  it("stamps one timestamp across a batch", () => {
    const built = buildResponses([{ questionId: "q1", value: "a" }, { questionId: "q2", value: 0 }], AT);
    expect(built).toEqual({
      q1: { value: "a", answeredAt: AT },
      q2: { value: 0, answeredAt: AT },
    });
  });

  it("returns an empty map for an empty batch", () => {
    expect(buildResponses([], AT)).toEqual({});
  });
});

describe("questionIds / unknownQuestionIds", () => {
  const sections = [section("s1", [question("q1")]), section("s2", [question("q2")])];

  it("lists every question id in author order", () => {
    expect(questionIds(sections)).toEqual(["q1", "q2"]);
  });

  it("flags submitted ids the structure does not define", () => {
    expect(unknownQuestionIds(sections, ["q1", "q9"])).toEqual(["q9"]);
    expect(unknownQuestionIds(sections, ["q1", "q2"])).toEqual([]);
  });
});
