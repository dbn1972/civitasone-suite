/**
 * Contract Templates — pure domain logic.
 *
 * Handles:
 * - Max 200 clauses per template
 * - Rank ordering (integer position)
 * - Conditional inclusion evaluation against contract metadata
 */

export class TemplateDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "TemplateDomainError";
  }
}

/** Maximum clauses composable into a single template. */
export const MAX_CLAUSES_PER_TEMPLATE = 200;

/** Valid template statuses. */
export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** Valid condition types for template clause inclusion. */
export const CONDITION_TYPES = ["always", "conditional"] as const;
export type ConditionType = (typeof CONDITION_TYPES)[number];

/** Valid condition operators. */
export const CONDITION_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/** Validates that adding a clause would not exceed the 200-clause limit. */
export function validateClauseCount(currentCount: number): void {
  if (currentCount >= MAX_CLAUSES_PER_TEMPLATE) {
    throw new TemplateDomainError(
      "CLAUSE_LIMIT_REACHED",
      `maximum ${MAX_CLAUSES_PER_TEMPLATE} clauses per template reached`,
    );
  }
}

/** Validates template status is valid. */
export function validateStatus(status: string): asserts status is TemplateStatus {
  if (!TEMPLATE_STATUSES.includes(status as TemplateStatus)) {
    throw new TemplateDomainError(
      "INVALID_STATUS",
      `status must be one of: ${TEMPLATE_STATUSES.join(", ")}`,
    );
  }
}

/**
 * Evaluates a condition against contract metadata.
 * Returns true if the clause should be included.
 */
export function evaluateCondition(
  conditionType: string,
  conditionField: string | null,
  conditionOperator: string | null,
  conditionValue: string | null,
  metadata: Record<string, unknown>,
): boolean {
  if (conditionType === "always") return true;
  if (!conditionField || !conditionOperator) return true;

  const fieldValue = metadata[conditionField];
  if (fieldValue === undefined || fieldValue === null) return false;

  const strFieldValue = String(fieldValue);
  const compareValue = conditionValue ?? "";

  switch (conditionOperator) {
    case "eq":
      return strFieldValue === compareValue;
    case "neq":
      return strFieldValue !== compareValue;
    case "gt":
      return Number(strFieldValue) > Number(compareValue);
    case "gte":
      return Number(strFieldValue) >= Number(compareValue);
    case "lt":
      return Number(strFieldValue) < Number(compareValue);
    case "lte":
      return Number(strFieldValue) <= Number(compareValue);
    case "contains":
      return strFieldValue.toLowerCase().includes(compareValue.toLowerCase());
    case "in": {
      const values = compareValue.split(",").map((v) => v.trim());
      return values.includes(strFieldValue);
    }
    default:
      return true;
  }
}

/**
 * Filters and orders template clauses based on conditions and rank.
 * Returns clause IDs in ascending rank order for clauses whose conditions evaluate to true.
 */
export function renderTemplateClauses<T extends {
  clauseId: string;
  rank: number;
  conditionType: string;
  conditionField: string | null;
  conditionOperator: string | null;
  conditionValue: string | null;
}>(
  clauses: T[],
  metadata: Record<string, unknown>,
): T[] {
  return clauses
    .filter((c) => evaluateCondition(c.conditionType, c.conditionField, c.conditionOperator, c.conditionValue, metadata))
    .sort((a, b) => a.rank - b.rank);
}
