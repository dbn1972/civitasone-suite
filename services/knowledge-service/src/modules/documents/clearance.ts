import type { RequestContext } from "@civitasone/types";
import { hasAnyRole } from "@civitasone/auth";
import { DOCUMENT_ACCESS_LEVELS } from "./validators.js";

/**
 * Roles cleared to see every document access level (incl. restricted and
 * confidential). Everyone else with a knowledge role is cleared for the
 * "public" and "internal" levels only.
 */
export const CLEARANCE_ALL_ROLES = ["knowledge_admin", "super_admin"] as const;

/** Access levels visible to ordinary knowledge users. */
export const STANDARD_ACCESS_LEVELS = ["public", "internal"] as const;

/**
 * Access levels the caller is cleared to read, or `null` when the caller is
 * cleared for all levels (no filter needed). The filter is applied in the
 * query itself, so an uncleared document is absent from the response body,
 * not merely hidden by the UI.
 */
export function clearedAccessLevels(ctx: RequestContext): readonly string[] | null {
  return hasAnyRole(ctx, [...CLEARANCE_ALL_ROLES]) ? null : STANDARD_ACCESS_LEVELS;
}

/** Stable cache-key segment for a clearance scope. */
export function clearanceScope(levels: readonly string[] | null): string {
  return levels === null ? "all" : [...levels].sort().join("+");
}

/** True when the caller may create a document at `level` (cannot create what they could not read back). */
export function canSetAccessLevel(ctx: RequestContext, level: string): boolean {
  const levels = clearedAccessLevels(ctx);
  return levels === null || levels.includes(level);
}

export { DOCUMENT_ACCESS_LEVELS };
