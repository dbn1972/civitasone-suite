/**
 * The exported vocabularies are the contract consumers build their zod enums from,
 * so a silent edit to either list is a breaking API change. Pinned here.
 */
import { describe, it, expect } from "vitest";
import { CONDITION_OPERATORS, QUESTION_TYPES } from "../src/types.js";
import { evaluateOperator } from "../src/visibility.js";

describe("exported vocabularies", () => {
  it("pins the question types", () => {
    expect([...QUESTION_TYPES]).toEqual([
      "text",
      "number",
      "boolean",
      "select",
      "multi_select",
      "date",
      "document",
      "signature",
    ]);
  });

  it("pins the condition operators", () => {
    expect([...CONDITION_OPERATORS]).toEqual(["eq", "neq", "gt", "lt", "in", "not_in"]);
  });

  it("every declared operator is implemented", () => {
    for (const operator of CONDITION_OPERATORS) {
      expect(typeof evaluateOperator(operator, 1, 1)).toBe("boolean");
    }
  });
});
