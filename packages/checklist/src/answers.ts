/**
 * What counts as "answered".
 *
 * This is the single definition every other function in the package defers to, so
 * scoring, progress and completion can never disagree about whether a question has
 * been filled in.
 *
 * A present-but-empty answer is NOT an answer. Blank strings and empty arrays reach
 * the API constantly (a cleared text box, a multi-select with every option
 * unticked), and treating them as answered would let a checklist report itself
 * complete while a mandatory field is visibly blank. `false` and `0` ARE answers —
 * "no" and "zero" are meaningful responses to a boolean or numeric question.
 */
import type { ChecklistResponses, ResponseEntry } from "./types.js";

export function isAnswered(entry: ResponseEntry | undefined): boolean {
  if (entry === undefined || entry === null) return false;
  const { value } = entry;
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** True when `responses` holds a usable answer for `questionId`. */
export function hasAnswer(responses: ChecklistResponses, questionId: string): boolean {
  return isAnswered(responses[questionId]);
}

/** The raw answer value, or `undefined` when the question is unanswered. */
export function answerValue(responses: ChecklistResponses, questionId: string): unknown {
  const entry = responses[questionId];
  return isAnswered(entry) ? entry?.value : undefined;
}
