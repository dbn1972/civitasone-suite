/**
 * Lead field rule domain logic — pure, no I/O (LM-001).
 *
 * Kept separate from the route so the mandatory-field decision can be exercised
 * exhaustively in unit tests, and so the same decision can later be reused by the
 * bulk importer without dragging a Fastify request along with it.
 */

/** The shape of a rule this module needs; deliberately narrower than the DB row. */
export interface FieldRuleLike {
  fieldName: string;
  required: boolean;
  enabled: boolean;
}

/**
 * A value counts as supplied only if it carries content. Whitespace is treated as
 * absent because " " in a mandatory field satisfies a null check while leaving the
 * record exactly as unusable as an empty one.
 */
export function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/**
 * Names of the mandatory fields absent from `attrs`, in rule order.
 *
 * Only enabled + required rules are considered: a disabled rule keeps its
 * configured weight for scoring but must not block a save, which is how a tenant
 * suspends enforcement during a data-cleanup window.
 */
export function validateRequiredFields(
  attrs: Record<string, unknown>,
  rules: ReadonlyArray<{ fieldName: string; required: boolean; enabled: boolean }>,
): string[] {
  const missing: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled || !rule.required) continue;
    if (isMissing(attrs[rule.fieldName])) missing.push(rule.fieldName);
  }
  return missing;
}
