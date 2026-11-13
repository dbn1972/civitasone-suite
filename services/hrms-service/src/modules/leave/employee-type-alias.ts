/**
 * S8-G3 -- ONE source of truth for the employee-type vocabulary the leave rules use.
 *
 * The employee record stores `contract`; the policy-rule admin screen has always offered
 * `contractual` (and the other values below), so a rule saved for "contractual" never matched a
 * "contract" employee. This module aliases the two directions. It is consulted ONLY by the
 * row-based resolver (tenant switch `custom_leave_rules_enabled`); the legacy path keeps its
 * exact-string lookup so tenants that never opt in see no change.
 */
import type { EmployeeType } from "./rules-engine.js";

/** Values accepted for a policy-rule's employee type (superset of the old enum, plus `contract`). */
export const LEAVE_RULE_EMPLOYEE_TYPES = [
  "permanent", "contractual", "contract", "vendor_deputed", "deputation",
  "consultant", "temporary", "intern", "apprentice", "volunteer",
] as const;

/** Aliases to the stored (canonical) spelling. */
const CANONICAL: Record<string, string> = { contract: "contractual" };
/** For each canonical value, the other spellings a record or an older rule row may carry. */
const LEGACY_SPELLINGS: Record<string, string[]> = { contractual: ["contract"] };

/** The spelling a policy rule is stored under. `contract` -> `contractual`; anything else unchanged. */
export function canonicalLeaveEmployeeType(raw: string): string {
  const v = raw.trim().toLowerCase();
  return CANONICAL[v] ?? v;
}

/** Candidate spellings to look a tenant rule up under, most specific first, no duplicates. */
export function leaveEmployeeTypeCandidates(raw: string): string[] {
  const v = raw.trim().toLowerCase();
  const canon = canonicalLeaveEmployeeType(v);
  return [...new Set([v, canon, ...(LEGACY_SPELLINGS[canon] ?? [])])];
}

/**
 * The engine's coarse bucket (used only to pick a built-in catalogue default's `applicableTo`).
 * Anything that is not clearly permanent/temporary/deputation is treated as `contract`, the more
 * restrictive bucket -- the opposite of the legacy route's "unknown => permanent".
 */
export function leaveEngineBucket(raw: string): EmployeeType {
  switch (canonicalLeaveEmployeeType(raw)) {
    case "permanent": return "permanent";
    case "temporary": return "temporary";
    case "deputation": return "deputation";
    default: return "contract";
  }
}
