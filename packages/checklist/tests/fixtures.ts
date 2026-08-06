import type { ChecklistQuestion, ChecklistResponses, ChecklistSection } from "../src/types.js";

export const AT = "2026-01-01T00:00:00.000Z";

export function question(
  id: string,
  overrides: Partial<ChecklistQuestion> = {},
): ChecklistQuestion {
  return {
    id,
    text: `Question ${id}`,
    type: "text",
    sortOrder: 1,
    weight: 1,
    required: true,
    ...overrides,
  };
}

export function section(
  id: string,
  questions: ChecklistQuestion[],
  overrides: Partial<ChecklistSection> = {},
): ChecklistSection {
  return {
    id,
    title: `Section ${id}`,
    sortOrder: 1,
    weight: 1,
    questions,
    ...overrides,
  };
}

/** Build a responses map from `{ questionId: value }`, all stamped with the same time. */
export function answers(values: Record<string, unknown>): ChecklistResponses {
  const out: ChecklistResponses = {};
  for (const [questionId, value] of Object.entries(values)) {
    out[questionId] = { value, answeredAt: AT };
  }
  return out;
}
