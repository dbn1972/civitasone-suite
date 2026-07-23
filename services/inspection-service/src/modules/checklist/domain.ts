/**
 * Checklist domain — pure functions for scoring, validation, and conditional logic.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8_
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Supported field types for checklist questions. */
export type FieldType =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "multi_select"
  | "photo"
  | "signature"
  | "geo_point";

/**
 * A conditional display rule that determines whether a question is shown or hidden
 * based on the value of another question's response.
 */
export interface ConditionalRule {
  /** The question ID whose response this rule depends on. */
  dependsOn: string;
  /** The comparison operator. */
  operator: "eq" | "neq" | "gt" | "lt";
  /** The value to compare against. */
  value: unknown;
  /** Whether to show or hide the target question when the condition is met. */
  action: "show" | "hide";
}

/**
 * A single question within a checklist section.
 */
export interface ChecklistQuestion {
  /** Unique identifier within the template. */
  id: string;
  /** The question text displayed to the inspector. */
  text: string;
  /** The input field type. */
  fieldType: FieldType;
  /** Display order within the section. */
  sortOrder: number;
  /** Weight for scoring (higher = more impactful on section score). */
  weight: number;
  /** Whether answering this question is mandatory for completion. */
  required: boolean;
  /** Optional validation rules (schema varies by fieldType). */
  validationRules?: object;
  /** Optional help text displayed to guide the inspector. */
  helpText?: string;
  /** Optional conditional display rules. */
  conditionalLogic?: ConditionalRule[];
}

/**
 * A section within a checklist template or instance.
 */
export interface ChecklistSection {
  /** Unique identifier within the template. */
  id: string;
  /** Section title. */
  title: string;
  /** Display order within the template. */
  sortOrder: number;
  /** Weight for overall score computation (section-level weighting). */
  weight: number;
  /** Optional prerequisite: this section unlocks only when the prerequisite section meets minScore. */
  prerequisite?: { sectionId: string; minScore: number };
  /** Ordered list of questions in this section. */
  questions: ChecklistQuestion[];
}

/** Shape of a single response entry in the responses map. */
export interface ResponseEntry {
  value: unknown;
  answeredAt: string;
}

/** Section score map: sectionId → score (0–100). */
export type SectionScores = Record<string, number>;

/** Completion validation result. */
export interface CompletionResult {
  valid: boolean;
  missingItems: string[];
}

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Domain-level error for checklist logic violations.
 * Kept separate from HttpError to maintain pure domain boundary.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure Functions ────────────────────────────────────────────────────────────

/**
 * Validate that all question IDs across all sections are unique.
 *
 * @param sections - Array of checklist sections to validate.
 * @returns `true` if all question IDs are unique.
 * @throws {DomainError} with code `DUPLICATE_QUESTION_IDS` listing the duplicate IDs.
 *
 * _Validates: Requirement 5.8_
 */
export function validateUniqueQuestionIds(sections: ChecklistSection[]): true {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const section of sections) {
    for (const question of section.questions) {
      if (seen.has(question.id)) {
        duplicates.add(question.id);
      }
      seen.add(question.id);
    }
  }

  if (duplicates.size > 0) {
    const dupeList = [...duplicates].sort().join(", ");
    throw new DomainError(
      "DUPLICATE_QUESTION_IDS",
      `Duplicate question IDs found: ${dupeList}`,
    );
  }

  return true;
}

/**
 * Compute section scores and overall checklist score.
 *
 * Section score = (sum of weights of answered required questions / sum of weights of all required questions) × 100.
 * Overall score = weighted average of section scores using section weights.
 *
 * @param sections - The checklist sections with questions.
 * @param responses - Map of questionId → { value, answeredAt }.
 * @returns Object with sectionScores (sectionId → 0–100) and overallScore (0–100).
 *
 * _Validates: Requirement 5.5_
 */
export function computeChecklistScores(
  sections: ChecklistSection[],
  responses: Record<string, ResponseEntry>,
): { sectionScores: SectionScores; overallScore: number } {
  const sectionScores: SectionScores = {};
  let totalSectionWeight = 0;
  let weightedScoreSum = 0;

  for (const section of sections) {
    const requiredQuestions = section.questions.filter((q) => q.required);

    if (requiredQuestions.length === 0) {
      // No required questions → section is fully complete by default
      sectionScores[section.id] = 100;
    } else {
      const totalRequiredWeight = requiredQuestions.reduce((sum, q) => sum + q.weight, 0);
      const answeredRequiredWeight = requiredQuestions
        .filter((q) => responses[q.id] !== undefined)
        .reduce((sum, q) => sum + q.weight, 0);

      sectionScores[section.id] =
        totalRequiredWeight > 0
          ? Math.round((answeredRequiredWeight / totalRequiredWeight) * 100)
          : 100;
    }

    const sectionScore = sectionScores[section.id] ?? 0;
    totalSectionWeight += section.weight;
    weightedScoreSum += section.weight * sectionScore;
  }

  const overallScore =
    totalSectionWeight > 0
      ? Math.round(weightedScoreSum / totalSectionWeight)
      : 0;

  return { sectionScores, overallScore };
}

/**
 * Evaluate a conditional logic rule against current responses.
 *
 * Returns `true` if the target element should be visible, `false` if hidden.
 * For "show" action: returns true when condition matches.
 * For "hide" action: returns true when condition does NOT match.
 *
 * @param rule - The conditional rule to evaluate.
 * @param responses - Map of questionId → { value }.
 * @returns `true` if the element should be shown, `false` if hidden.
 *
 * _Validates: Requirement 5.4_
 */
export function evaluateConditionalLogic(
  rule: ConditionalRule,
  responses: Record<string, { value: unknown }>,
): boolean {
  const response = responses[rule.dependsOn];
  const responseValue = response?.value;
  const conditionMet = evaluateOperator(rule.operator, responseValue, rule.value);

  if (rule.action === "show") {
    return conditionMet;
  }
  // action === "hide": hide when condition is met → show when NOT met
  return !conditionMet;
}

/**
 * Evaluate a comparison operator between two values.
 *
 * For "eq" and "neq": uses strict equality after coercion to same type.
 * For "gt" and "lt": numeric comparison (both values coerced to number).
 */
function evaluateOperator(operator: "eq" | "neq" | "gt" | "lt", actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return Number(actual) > Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
  }
}

/**
 * Validate that an inspection checklist is complete for submission.
 *
 * Completion requires:
 * 1. All required questions across all sections have responses.
 * 2. Evidence count meets or exceeds the required minimum.
 *
 * @param sections - The checklist sections with questions.
 * @param responses - Map of questionId → { value, answeredAt }.
 * @param evidenceCount - Number of evidence artifacts attached.
 * @param requiredEvidenceCount - Minimum required evidence artifacts.
 * @returns Object with `valid` boolean and `missingItems` listing what's missing.
 *
 * _Validates: Requirement 5.6, 8.3, 8.4_
 */
export function validateCompletion(
  sections: ChecklistSection[],
  responses: Record<string, ResponseEntry>,
  evidenceCount: number,
  requiredEvidenceCount: number,
): CompletionResult {
  const missingItems: string[] = [];

  for (const section of sections) {
    for (const question of section.questions) {
      if (question.required && responses[question.id] === undefined) {
        missingItems.push(`question:${question.id}`);
      }
    }
  }

  if (evidenceCount < requiredEvidenceCount) {
    missingItems.push(
      `evidence:need ${requiredEvidenceCount}, have ${evidenceCount}`,
    );
  }

  return {
    valid: missingItems.length === 0,
    missingItems,
  };
}

/**
 * Assert that a template is NOT already published (immutability enforcement).
 * Published templates cannot be modified — a new version must be created instead.
 *
 * @param status - The current template status.
 * @throws {DomainError} with code `TEMPLATE_IMMUTABLE` if the template is already published.
 *
 * _Validates: Requirement 5.2_
 */
export function assertTemplatePublished(status: string): void {
  if (status === "published") {
    throw new DomainError(
      "TEMPLATE_IMMUTABLE",
      "Published templates are immutable. Create a new version to make changes.",
    );
  }
}

/**
 * Assert that a template is in draft status (required before publishing).
 *
 * @param status - The current template status.
 * @throws {DomainError} with code `TEMPLATE_NOT_DRAFT` if the template is not in draft status.
 *
 * _Validates: Requirement 5.2_
 */
export function assertTemplateDraft(status: string): void {
  if (status !== "draft") {
    throw new DomainError(
      "TEMPLATE_NOT_DRAFT",
      `Template must be in 'draft' status to publish, currently '${status}'.`,
    );
  }
}

/**
 * Check whether a section's prerequisite is satisfied.
 *
 * A section with a prerequisite only unlocks when the prerequisite section's
 * score meets or exceeds the required minimum threshold.
 *
 * @param sectionId - The section being checked (for error context).
 * @param sectionScores - Map of sectionId → score (0–100).
 * @param prerequisite - The prerequisite condition (sectionId + minScore).
 * @returns `true` if the prerequisite section's score ≥ minScore threshold.
 *
 * _Validates: Requirement 5.6_
 */
export function checkPrerequisiteSection(
  _sectionId: string,
  sectionScores: SectionScores,
  prerequisite: { sectionId: string; minScore: number },
): boolean {
  const prereqScore = sectionScores[prerequisite.sectionId];

  // If the prerequisite section has no score yet, it's not met
  if (prereqScore === undefined) {
    return false;
  }

  return prereqScore >= prerequisite.minScore;
}
