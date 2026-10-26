/**
 * Owner decision #33 (GAP-COURT-CAUSE-LIST-03): cause-list slots and courtrooms are PER-COURT config
 * (config-registry namespaces seeded with defaults when a court is created). These helpers MUST stay in
 * lock-step with services/court-service/src/modules/cause-list/domain.ts (parity is pinned by a test).
 */
import type { ConfigEntry } from "./types";

function courtHex(courtId: string): string {
  return courtId.replace(/-/g, "").toLowerCase();
}

export function causeListSlotNamespace(courtId: string): string {
  return `cl_slot_${courtHex(courtId)}`;
}

export function causeListCourtroomNamespace(courtId: string): string {
  return `cl_room_${courtHex(courtId)}`;
}

export const DEFAULT_CAUSE_LIST_SLOTS = ["AM-1", "AM-2", "PM-1", "PM-2"] as const;
export const DEFAULT_CAUSE_LIST_COURTROOMS = ["COURT-1"] as const;

export type CauseListOption = { value: string; label: string };

/**
 * The options a court offers: its own ACTIVE entries when it has any (authoritative - they replace the
 * defaults, exactly as the service validates), in configured order; else the defaults. The config KEY is the
 * value that is sent; a configured label is only for display.
 */
export function effectiveCauseListOptions(
  entries: ConfigEntry[],
  defaults: readonly string[],
): CauseListOption[] {
  const active = entries
    .filter((e) => e.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.configKey.localeCompare(b.configKey));
  if (active.length === 0) return defaults.map((d) => ({ value: d, label: d }));
  return active.map((e) => ({ value: e.configKey, label: e.label?.trim() || e.configKey }));
}
