/**
 * Completion + progress.
 *
 * "Outstanding" means: required, currently visible, in a currently available section,
 * and unanswered. All three qualifiers matter — a checklist that demanded answers to
 * hidden questions or to sections still locked behind a prerequisite could never be
 * completed, which is the failure mode this whole engine exists to avoid.
 *
 * Progress is measured over the same denominator, so a checklist reporting 100%
 * progress and a checklist reporting `complete` are always the same checklist.
 */
import { isAnswered } from "./answers.js";
import { computeScores } from "./scoring.js";
import { isQuestionVisible } from "./visibility.js";
import type { ChecklistResponses, ChecklistSection, SectionScores } from "./types.js";

/** One outstanding item, with enough context to render it without re-walking the tree. */
export interface OutstandingItem {
  questionId: string;
  sectionId: string;
  text: string;
}

export interface CompletionState {
  /** True when nothing required, visible and available is unanswered. */
  complete: boolean;
  /** 0–100 integer over required + visible + available questions. */
  progressPercent: number;
  requiredTotal: number;
  requiredAnswered: number;
  /** Ids of the questions still to answer, in author order. */
  unansweredRequired: string[];
  /** The same items with section and prompt text attached. */
  outstanding: OutstandingItem[];
  sectionScores: SectionScores;
  /** Weighted overall score, 0–100. */
  score: number;
  availableSectionIds: string[];
  lockedSectionIds: string[];
}

/** Required + visible + available questions, paired with their section. */
function obligations(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
  availableIds: ReadonlySet<string>,
): Array<{ section: ChecklistSection; questionId: string; text: string; answered: boolean }> {
  const out: Array<{ section: ChecklistSection; questionId: string; text: string; answered: boolean }> = [];
  for (const section of sections) {
    if (!availableIds.has(section.id)) continue;
    for (const question of section.questions) {
      if (!question.required) continue;
      if (!isQuestionVisible(question, responses)) continue;
      out.push({
        section,
        questionId: question.id,
        text: question.text,
        answered: isAnswered(responses[question.id]),
      });
    }
  }
  return out;
}

/** Full completion picture: progress, outstanding items and score in one pass. */
export function evaluateCompletion(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): CompletionState {
  const { sectionScores, overallScore, availability } = computeScores(sections, responses);
  const availableSectionIds = sections.filter((s) => availability[s.id] === true).map((s) => s.id);
  const lockedSectionIds = sections.filter((s) => availability[s.id] !== true).map((s) => s.id);

  const items = obligations(sections, responses, new Set(availableSectionIds));
  const outstanding = items
    .filter((i) => !i.answered)
    .map((i) => ({ questionId: i.questionId, sectionId: i.section.id, text: i.text }));
  const requiredTotal = items.length;
  const requiredAnswered = requiredTotal - outstanding.length;

  return {
    complete: outstanding.length === 0,
    // Nothing outstanding means 100%, including the empty-checklist case: there is no
    // work left, and reporting 0% for a checklist with nothing to do is just wrong.
    progressPercent: requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100),
    requiredTotal,
    requiredAnswered,
    unansweredRequired: outstanding.map((o) => o.questionId),
    outstanding,
    sectionScores,
    score: overallScore,
    availableSectionIds,
    lockedSectionIds,
  };
}

/** Ids of required, visible, available questions that are still unanswered. */
export function findUnansweredRequired(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): string[] {
  return evaluateCompletion(sections, responses).unansweredRequired;
}

/** True when nothing required, visible and available is outstanding. */
export function isComplete(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): boolean {
  return evaluateCompletion(sections, responses).complete;
}

/** 0–100 integer progress over required, visible, available questions. */
export function computeProgressPercent(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): number {
  return evaluateCompletion(sections, responses).progressPercent;
}
