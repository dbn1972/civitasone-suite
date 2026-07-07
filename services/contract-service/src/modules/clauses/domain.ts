/**
 * Clause Library — pure domain validation functions.
 */

export class ClauseDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ClauseDomainError";
  }
}

/** Maximum clause body length in characters. */
export const MAX_BODY_LENGTH = 50_000;

/** Maximum merge fields per clause. */
export const MAX_MERGE_FIELDS = 100;

/** Maximum clauses per tenant. */
export const MAX_CLAUSES_PER_TENANT = 10_000;

/** Validates that body length does not exceed 50,000 characters. */
export function validateBody(body: string): void {
  if (body.length > MAX_BODY_LENGTH) {
    throw new ClauseDomainError(
      "BODY_TOO_LONG",
      `clause body must not exceed ${MAX_BODY_LENGTH} characters (got ${body.length})`,
    );
  }
}

/** Validates merge fields: must be an array of non-empty strings, max 100 fields. */
export function validateMergeFields(fields: unknown): asserts fields is string[] {
  if (!Array.isArray(fields)) {
    throw new ClauseDomainError("INVALID_MERGE_FIELDS", "mergeFields must be an array");
  }
  if (fields.length > MAX_MERGE_FIELDS) {
    throw new ClauseDomainError(
      "TOO_MANY_MERGE_FIELDS",
      `mergeFields must not exceed ${MAX_MERGE_FIELDS} entries (got ${fields.length})`,
    );
  }
  for (let i = 0; i < fields.length; i++) {
    if (typeof fields[i] !== "string" || fields[i].trim().length === 0) {
      throw new ClauseDomainError(
        "INVALID_MERGE_FIELD",
        `mergeFields[${i}] must be a non-empty string`,
      );
    }
  }
}

/** Valid clause status values. */
export const CLAUSE_STATUSES = ["active", "archived"] as const;
export type ClauseStatus = (typeof CLAUSE_STATUSES)[number];
