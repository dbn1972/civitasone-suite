/**
 * Shared display rules for a grievance row, used by BOTH the register table and the
 * detail page so the two cannot drift apart.
 */

/**
 * GAP-CRM-GRIEVANCES-06: the CPGRAMS status APPEAL is what the workflow calls a FIRST
 * APPEAL (the action button, the register tile and the detail timeline all say "First
 * appeal"), but the status pill printed the humanised enum -- "Appeal". Return the label
 * to hand to StatusPill for that one status; every other status keeps the shared
 * humanised default (undefined).
 */
export function grievanceStatusLabel(status: string, firstAppealLabel: string): string | undefined {
  return status.trim().toUpperCase() === "APPEAL" ? firstAppealLabel : undefined;
}

/**
 * Priority -> the shared `.pill` tone class. `.pill.bad/.warn/.mut` pair a foreground and a
 * background TOKEN that clear WCAG AA (4.5:1) in both themes; the old inline
 * `color: var(--bg)` on a `var(--ink2|--warn|--bad)` fill did not follow the dark theme.
 */
export const GRIEVANCE_PRIORITY_PILL: Readonly<Record<string, "bad" | "warn" | "mut">> = {
  urgent: "bad",
  high: "warn",
  normal: "mut",
  low: "mut",
};

export function grievancePriorityPillClass(priority: string): string {
  return `pill ${GRIEVANCE_PRIORITY_PILL[priority] ?? "mut"}`;
}
