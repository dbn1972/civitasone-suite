import { describe, it, expect } from "vitest";
import { ChecklistDomainError } from "../src/errors.js";
import {
  validateConditionalReferences,
  validatePrerequisites,
  validateStructure,
  validateUniqueQuestionIds,
  validateUniqueSectionIds,
  validateWeights,
} from "../src/validate.js";
import { question, section } from "./fixtures.js";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ChecklistDomainError) return err.code;
    throw err;
  }
  return "NO_ERROR";
}

describe("validateUniqueQuestionIds", () => {
  it("accepts unique ids across sections", () => {
    const sections = [section("s1", [question("q1")]), section("s2", [question("q2")])];
    expect(validateUniqueQuestionIds(sections)).toBe(true);
  });

  it("rejects an id reused in another section", () => {
    const sections = [section("s1", [question("q1")]), section("s2", [question("q1")])];
    expect(codeOf(() => validateUniqueQuestionIds(sections))).toBe("DUPLICATE_QUESTION_IDS");
  });

  it("rejects an id reused inside one section", () => {
    const sections = [section("s1", [question("q1"), question("q1")])];
    expect(codeOf(() => validateUniqueQuestionIds(sections))).toBe("DUPLICATE_QUESTION_IDS");
  });
});

describe("validateUniqueSectionIds", () => {
  it("accepts distinct section ids", () => {
    expect(validateUniqueSectionIds([section("s1", []), section("s2", [])])).toBe(true);
  });

  it("rejects duplicate section ids", () => {
    expect(codeOf(() => validateUniqueSectionIds([section("s1", []), section("s1", [])]))).toBe(
      "DUPLICATE_SECTION_IDS",
    );
  });
});

describe("validateWeights", () => {
  it("accepts zero and positive weights", () => {
    expect(validateWeights([section("s1", [question("q1", { weight: 0 })], { weight: 0 })])).toBe(true);
  });

  it("rejects a negative section weight", () => {
    expect(codeOf(() => validateWeights([section("s1", [], { weight: -1 })]))).toBe(
      "INVALID_SECTION_WEIGHT",
    );
  });

  it("rejects a non-finite section weight", () => {
    expect(codeOf(() => validateWeights([section("s1", [], { weight: Number.NaN })]))).toBe(
      "INVALID_SECTION_WEIGHT",
    );
  });

  it("rejects a negative question weight", () => {
    expect(codeOf(() => validateWeights([section("s1", [question("q1", { weight: -2 })])]))).toBe(
      "INVALID_QUESTION_WEIGHT",
    );
  });

  it("rejects a prerequisite minScore outside 0–100", () => {
    const over = [
      section("s1", []),
      section("s2", [], { prerequisite: { sectionId: "s1", minScore: 101 } }),
    ];
    expect(codeOf(() => validateWeights(over))).toBe("INVALID_PREREQUISITE_SCORE");
    const under = [
      section("s1", []),
      section("s2", [], { prerequisite: { sectionId: "s1", minScore: -1 } }),
    ];
    expect(codeOf(() => validateWeights(under))).toBe("INVALID_PREREQUISITE_SCORE");
  });
});

describe("validateConditionalReferences", () => {
  it("accepts a rule pointing at a question in another section", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [
        question("q2", {
          conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: "yes", action: "show" }],
        }),
      ]),
    ];
    expect(validateConditionalReferences(sections)).toBe(true);
  });

  it("rejects a rule pointing at a question that does not exist", () => {
    const sections = [
      section("s1", [
        question("q1", {
          conditionalLogic: [{ dependsOn: "ghost", operator: "eq", value: 1, action: "show" }],
        }),
      ]),
    ];
    expect(codeOf(() => validateConditionalReferences(sections))).toBe("UNKNOWN_CONDITION_DEPENDENCY");
  });

  it("rejects a question conditioned on its own answer", () => {
    const sections = [
      section("s1", [
        question("q1", {
          conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: 1, action: "show" }],
        }),
      ]),
    ];
    expect(codeOf(() => validateConditionalReferences(sections))).toBe("SELF_REFERENTIAL_CONDITION");
  });

  it("rejects in/not_in with a non-array value", () => {
    const sections = [
      section("s1", [
        question("q1"),
        question("q2", {
          conditionalLogic: [{ dependsOn: "q1", operator: "in", value: "a", action: "show" }],
        }),
      ]),
    ];
    expect(codeOf(() => validateConditionalReferences(sections))).toBe("INVALID_CONDITION_VALUE");
  });
});

describe("validatePrerequisites", () => {
  it("accepts a chain that terminates", () => {
    const sections = [
      section("a", []),
      section("b", [], { prerequisite: { sectionId: "a", minScore: 50 } }),
      section("c", [], { prerequisite: { sectionId: "b", minScore: 50 } }),
    ];
    expect(validatePrerequisites(sections)).toBe(true);
  });

  it("rejects a self-referential prerequisite", () => {
    const sections = [section("a", [], { prerequisite: { sectionId: "a", minScore: 1 } })];
    expect(codeOf(() => validatePrerequisites(sections))).toBe("SELF_REFERENTIAL_PREREQUISITE");
  });

  it("rejects a prerequisite naming an unknown section", () => {
    const sections = [section("a", [], { prerequisite: { sectionId: "ghost", minScore: 1 } })];
    expect(codeOf(() => validatePrerequisites(sections))).toBe("UNKNOWN_PREREQUISITE");
  });

  it("rejects a two-section cycle", () => {
    const sections = [
      section("a", [], { prerequisite: { sectionId: "b", minScore: 1 } }),
      section("b", [], { prerequisite: { sectionId: "a", minScore: 1 } }),
    ];
    expect(codeOf(() => validatePrerequisites(sections))).toBe("PREREQUISITE_CYCLE");
  });

  it("rejects a three-section cycle", () => {
    const sections = [
      section("a", [], { prerequisite: { sectionId: "c", minScore: 1 } }),
      section("b", [], { prerequisite: { sectionId: "a", minScore: 1 } }),
      section("c", [], { prerequisite: { sectionId: "b", minScore: 1 } }),
    ];
    expect(codeOf(() => validatePrerequisites(sections))).toBe("PREREQUISITE_CYCLE");
  });
});

describe("validateStructure", () => {
  it("accepts a well-formed template", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [
        question("q2", {
          conditionalLogic: [{ dependsOn: "q1", operator: "eq", value: "yes", action: "show" }],
        }),
      ], { sortOrder: 2, prerequisite: { sectionId: "s1", minScore: 100 } }),
    ];
    expect(validateStructure(sections)).toBe(true);
  });

  it("accepts an empty template", () => {
    expect(validateStructure([])).toBe(true);
  });

  it("surfaces the first violation it finds", () => {
    const sections = [section("s1", [question("q1")]), section("s1", [question("q1")])];
    expect(codeOf(() => validateStructure(sections))).toBe("DUPLICATE_SECTION_IDS");
  });

  it("carries a ChecklistDomainError name and code", () => {
    try {
      validateStructure([section("s1", []), section("s1", [])]);
      expect.unreachable("expected a domain error");
    } catch (err) {
      expect(err).toBeInstanceOf(ChecklistDomainError);
      expect((err as ChecklistDomainError).name).toBe("ChecklistDomainError");
      expect((err as ChecklistDomainError).message).toContain("s1");
    }
  });
});
