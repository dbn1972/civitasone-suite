/**
 * Scoring.
 *
 * Section score = weighted proportion of the section's VISIBLE REQUIRED questions
 * that are answered, as a 0–100 integer. Hidden questions are excluded: a question
 * the respondent was never shown must not depress the score. Optional questions are
 * excluded too — they carry no obligation, so answering them cannot raise a score
 * above what the mandatory work earns.
 *
 * Overall score = section scores averaged by section weight, over the sections that
 * are AVAILABLE (their prerequisite chain is satisfied). A section still locked
 * behind a prerequisite has not been asked yet, so counting its zero would report a
 * failing checklist to someone who has done everything asked of them so far.
 *
 * Weight 0 everywhere is treated as "unweighted" (each item counts once) rather than
 * as a division by zero. Templates authored without thinking about weights are
 * common, and silently scoring them 0 or NaN would be worse than scoring them evenly.
 */
import { isAnswered } from "./answers.js";
import { resolveSectionAvailability } from "./prerequisites.js";
import { isQuestionVisible } from "./visibility.js";
import type {
  AvailabilityMap,
  ChecklistResponses,
  ChecklistSection,
  SectionScores,
} from "./types.js";

/** Average of `value` weighted by `weight`, rounded; unweighted fallback when all weights are 0. */
function weightedAverage(entries: ReadonlyArray<{ weight: number; value: number }>): number {
  if (entries.length === 0) return 0;
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight <= 0) {
    const plain = entries.reduce((sum, e) => sum + e.value, 0) / entries.length;
    return Math.round(plain);
  }
  return Math.round(entries.reduce((sum, e) => sum + e.weight * e.value, 0) / totalWeight);
}

/**
 * Score one section, 0–100. A section with no visible required questions scores 100:
 * there is nothing outstanding in it.
 */
export function computeSectionScore(
  section: ChecklistSection,
  responses: ChecklistResponses,
): number {
  const required = section.questions.filter(
    (q) => q.required && isQuestionVisible(q, responses),
  );
  if (required.length === 0) return 100;

  const totalWeight = required.reduce((sum, q) => sum + q.weight, 0);
  if (totalWeight <= 0) {
    const answered = required.filter((q) => isAnswered(responses[q.id])).length;
    return Math.round((answered / required.length) * 100);
  }

  const answeredWeight = required
    .filter((q) => isAnswered(responses[q.id]))
    .reduce((sum, q) => sum + q.weight, 0);
  return Math.round((answeredWeight / totalWeight) * 100);
}

/** sectionId → score, for every section. */
export function computeSectionScores(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): SectionScores {
  const scores: SectionScores = {};
  for (const section of sections) {
    scores[section.id] = computeSectionScore(section, responses);
  }
  return scores;
}

/**
 * Section scores plus the weighted overall score, and the availability map the
 * overall score was derived from (so callers do not recompute it).
 */
export function computeScores(
  sections: readonly ChecklistSection[],
  responses: ChecklistResponses,
): { sectionScores: SectionScores; overallScore: number; availability: AvailabilityMap } {
  const sectionScores = computeSectionScores(sections, responses);
  const availability = resolveSectionAvailability(sections, sectionScores);
  const contributing = sections
    .filter((s) => availability[s.id] === true)
    .map((s) => ({ weight: s.weight, value: sectionScores[s.id] ?? 0 }));
  return { sectionScores, overallScore: weightedAverage(contributing), availability };
}
