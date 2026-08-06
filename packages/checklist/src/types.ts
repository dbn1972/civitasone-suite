/**
 * Checklist template + instance structural types.
 *
 * The shape follows the engine already proven in inspection-service
 * (`services/inspection-service/src/modules/checklist`): a template is an ordered
 * list of weighted sections, each holding weighted questions, with optional
 * conditional visibility on questions and an optional score prerequisite on
 * sections. Keeping the shape identical is deliberate — it is the model the product
 * already runs on, and divergence would make a future consolidation impossible.
 */

/** Input widget / answer kind for a question. */
export const QUESTION_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "multi_select",
  "date",
  "document",
  "signature",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Comparison operators available to a conditional visibility rule. */
export const CONDITION_OPERATORS = ["eq", "neq", "gt", "lt", "in", "not_in"] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Whether a matched condition reveals or conceals the question carrying it. */
export type ConditionAction = "show" | "hide";

/**
 * One conditional visibility rule: "look at the answer to `dependsOn`, compare it to
 * `value` with `operator`, and `action` the question this rule is attached to".
 */
export interface ConditionalRule {
  /** Id of the question whose answer this rule reads. */
  dependsOn: string;
  operator: ConditionOperator;
  /** Right-hand side of the comparison. For `in`/`not_in` this must be an array. */
  value: unknown;
  action: ConditionAction;
}

/** A single question inside a section. */
export interface ChecklistQuestion {
  /** Unique across the WHOLE template, not just its section. */
  id: string;
  text: string;
  type: QuestionType;
  /** Display order inside the section. */
  sortOrder: number;
  /** Relative scoring weight within the section. */
  weight: number;
  /** Required questions drive completion; optional ones never block it. */
  required: boolean;
  /**
   * `| undefined` is spelled out on every optional property in this file because the
   * repo compiles with `exactOptionalPropertyTypes`. Without it, a value parsed by zod
   * (which produces `prop?: T | undefined`) is not assignable to this type, and every
   * consumer would need a cast at the boundary to store what it just validated.
   */
  helpText?: string | undefined;
  /** All rules must permit the question for it to be visible (AND semantics). */
  conditionalLogic?: ConditionalRule[] | undefined;
}

/** A section only becomes available once `sectionId` has scored at least `minScore`. */
export interface SectionPrerequisite {
  sectionId: string;
  /** 0–100, compared against the prerequisite section's computed score. */
  minScore: number;
}

/** A weighted group of questions. */
export interface ChecklistSection {
  id: string;
  title: string;
  sortOrder: number;
  /** Relative weight of this section in the overall score. */
  weight: number;
  prerequisite?: SectionPrerequisite | undefined;
  questions: ChecklistQuestion[];
}

/**
 * The whole template body. Carried as a single JSONB column by consumers, and
 * deep-copied into an instance at creation so a later template version cannot
 * retroactively change what an in-flight case was asked.
 */
export interface ChecklistStructure {
  sections: ChecklistSection[];
}

/** One recorded answer. `answeredAt` is an ISO-8601 UTC timestamp. */
export interface ResponseEntry {
  value: unknown;
  answeredAt: string;
}

/** questionId → answer. Partial by design: a checklist is filled in over time. */
export type ChecklistResponses = Record<string, ResponseEntry>;

/** sectionId → score in the range 0–100. */
export type SectionScores = Record<string, number>;

/** questionId → whether the question is currently visible. */
export type VisibilityMap = Record<string, boolean>;

/** sectionId → whether the section's prerequisite chain is satisfied. */
export type AvailabilityMap = Record<string, boolean>;
