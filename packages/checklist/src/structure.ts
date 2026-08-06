/**
 * Structure copying + response merging.
 *
 * `freezeStructure` is what makes an instance independent of its template. An
 * instance stores its own deep copy, so publishing a new template version cannot
 * retroactively change what an in-flight case was asked — the difference between an
 * audit trail and a rewrite of history.
 *
 * `mergeResponses` implements partial saves: a submission carries only the answers
 * the respondent touched, and everything else must survive untouched.
 */
import type { ChecklistResponses, ChecklistSection, ResponseEntry } from "./types.js";

/**
 * Deep, structurally-shared-nothing copy, with sections and questions put into
 * `sortOrder` order so every reader (API, UI, export) sees the same sequence.
 *
 * `structuredClone` is used rather than a JSON round-trip because it preserves
 * `undefined`-free object graphs without silently dropping keys, and it throws on a
 * value that could not survive a JSONB column anyway (functions, symbols).
 */
export function freezeStructure(sections: readonly ChecklistSection[]): ChecklistSection[] {
  const copy = structuredClone(sections) as ChecklistSection[];
  const ordered = [...copy].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const section of ordered) {
    section.questions = [...section.questions].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return ordered;
}

/**
 * Apply a partial submission on top of what is already recorded. Later answers win;
 * untouched questions keep their previous entry, including their original
 * `answeredAt` so an audit shows when each answer was actually given.
 */
export function mergeResponses(
  existing: ChecklistResponses,
  incoming: ChecklistResponses,
): ChecklistResponses {
  return { ...existing, ...incoming };
}

/** Build response entries stamped with one timestamp, for a batch submission. */
export function buildResponses(
  answers: ReadonlyArray<{ questionId: string; value: unknown }>,
  answeredAt: string,
): ChecklistResponses {
  const out: ChecklistResponses = {};
  for (const answer of answers) {
    const entry: ResponseEntry = { value: answer.value, answeredAt };
    out[answer.questionId] = entry;
  }
  return out;
}

/** Every question id in the structure, in author order. Useful for guarding submissions. */
export function questionIds(sections: readonly ChecklistSection[]): string[] {
  return sections.flatMap((s) => s.questions.map((q) => q.id));
}

/** Ids present in `answers` that the structure does not define. */
export function unknownQuestionIds(
  sections: readonly ChecklistSection[],
  answeredIds: readonly string[],
): string[] {
  const known = new Set(questionIds(sections));
  return answeredIds.filter((id) => !known.has(id));
}
