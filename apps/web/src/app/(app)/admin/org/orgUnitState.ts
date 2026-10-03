import type { AdminOrgUnit } from "@/app/_data/loaders";

/** YYYY-MM-DD of an instant on the IST calendar. */
function istDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * GAP-ADMIN-ORG-03: a unit is deactivated by end-dating it (tenant-service sets
 * effectiveTo); the row is kept for history and audit. Inactive = the end date's IST
 * calendar day is today (IST) or earlier; a later day is still in force. This is the
 * same rule as tenant-service org-hierarchy/state.ts isUnitInactive.
 */
export function isUnitInactive(u: Pick<AdminOrgUnit, "effectiveTo">, nowMs: number): boolean {
  if (!u.effectiveTo) return false;
  const t = Date.parse(u.effectiveTo);
  return Number.isFinite(t) && istDate(t) <= istDate(nowMs);
}

/** In-force direct children of `unitId`. */
export function activeChildCount(units: readonly AdminOrgUnit[], unitId: string, nowMs: number): number {
  return units.filter((u) => u.parentId === unitId && !isUnitInactive(u, nowMs)).length;
}

/** Display name for a head-of-unit id: the directory name, or a neutral label -- never the raw id. */
export function headDisplayName(headUserId: string | null, directory: ReadonlyMap<string, string>): string | null {
  if (!headUserId) return null;
  return directory.get(headUserId) ?? "Unknown user";
}

/** Plain-language reason for a refused deactivate/move, keyed by the backend's machine code. */
export function orgConflictMessage(code: string | undefined): string | null {
  switch (code) {
    case "HAS_ACTIVE_CHILDREN": return "This unit still has active sub-units. Move or deactivate them first.";
    case "HAS_ACTIVE_POSITIONS": return "This unit still has open positions. Move or abolish them, or confirm below that they stay in a deactivated unit.";
    case "UNIT_INACTIVE": return "This unit is deactivated and can no longer be changed.";
    case "ALREADY_INACTIVE": return "This unit is already deactivated.";
    case "PARENT_INACTIVE": return "The chosen parent is deactivated. Choose an active parent.";
    case "HIERARCHY_CYCLE": return "That move would place the unit under one of its own sub-units, so it was not applied. Choose a different parent.";
    default: return null;
  }
}
