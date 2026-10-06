/**
 * GAP-TENANT-ADMIN-USAGE-02: single source of truth for the usage/quota
 * thresholds. Before this, the amber bar (70%), the "Upgrade" affordance
 * (80%), the warning banner (90%) and the "Critical" tile (90%) each hard-coded
 * their own number in two files, so the UI contradicted itself ("Warning
 * 70-90%" vs a tile labelled ">90%" that actually counted >=90). Everything
 * now derives from these two constants so the bands can never drift apart.
 *
 * Bands (by percent of limit used):
 *   p <  WARN_PCT            -> OK (green)
 *   WARN_PCT <= p < CRIT_PCT -> Warning (amber), Upgrade shown
 *   p >= CRIT_PCT            -> Critical (red), banner shown
 */
export const WARN_PCT = 70;
export const CRIT_PCT = 90;

/** Shared destination for every "Upgrade" link on this page (GAP-USAGE-04). */
export const PLANS_HREF = "/tenant-admin/plans";

export type UsageBand = "ok" | "warning" | "critical";

export function usageBand(percent: number): UsageBand {
  if (percent >= CRIT_PCT) return "critical";
  if (percent >= WARN_PCT) return "warning";
  return "ok";
}

/** Upgrade affordance appears once a resource is in the warning band or worse. */
export function showUpgrade(percent: number): boolean {
  return percent >= WARN_PCT;
}
