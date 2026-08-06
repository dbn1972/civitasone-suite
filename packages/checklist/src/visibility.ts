/**
 * Conditional visibility resolution.
 *
 * A question with no rules is always visible. A question with rules is visible only
 * when EVERY rule permits it (AND semantics) — the safe reading, because an author
 * who adds a second rule is narrowing when the question applies, not widening it.
 *
 * Rules read the RAW recorded value (`undefined` when nothing was recorded), not the
 * "is it a meaningful answer" notion in `answers.ts`. A rule may legitimately test for
 * emptiness, and collapsing `""` to `undefined` here would make that untestable.
 */
import type {
  ChecklistQuestion,
  ChecklistResponses,
  ChecklistSection,
  ConditionOperator,
  ConditionalRule,
  VisibilityMap,
} from "./types.js";

/**
 * Compare two values with one operator.
 *
 * `eq`/`neq` are strict — no type coercion, so `"1"` never equals `1`. `gt`/`lt`
 * coerce to number, and a non-numeric operand makes the comparison false rather
 * than throwing (NaN comparisons are false, which is the behaviour we want: an
 * unanswered numeric question does not satisfy a threshold). `in`/`not_in` require
 * an array right-hand side; anything else is treated as "not a member".
 */
export function evaluateOperator(
  operator: ConditionOperator,
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "not_in":
      return Array.isArray(expected) ? !expected.includes(actual) : false;
  }
}

/**
 * Evaluate one rule. Returns whether the rule PERMITS the question to be shown:
 * a `show` rule permits when its condition matches, a `hide` rule permits when it
 * does not.
 */
export function evaluateConditionalRule(
  rule: ConditionalRule,
  responses: ChecklistResponses,
): boolean {
  const actual = responses[rule.dependsOn]?.value;
  const matched = evaluateOperator(rule.operator, actual, rule.value);
  return rule.action === "show" ? matched : !matched;
}

/** True when every rule on the question permits it (vacuously true with no rules). */
export function isQuestionVisible(
  question: ChecklistQuestion,
  responses: ChecklistResponses,
): boolean {
  const rules = question.conditionalLogic;
  if (rules === undefined || rules.length === 0) return true;
  return rules.every((rule) => evaluateConditionalRule(rule, responses));
}

/** questionId → visibility, across every section. */
export function resolveVisibility(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): VisibilityMap {
  const map: VisibilityMap = {};
  for (const section of sections) {
    for (const question of section.questions) {
      map[question.id] = isQuestionVisible(question, responses);
    }
  }
  return map;
}

/** The currently visible questions of one section, in author order. */
export function visibleQuestions(
  section: ChecklistSection,
  responses: ChecklistResponses,
): ChecklistQuestion[] {
  return section.questions.filter((q) => isQuestionVisible(q, responses));
}
