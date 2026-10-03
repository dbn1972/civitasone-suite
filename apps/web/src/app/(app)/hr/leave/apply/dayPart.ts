/**
 * GAP-HR-LEAVE-APPLY-05: which "duration" choices the apply form offers.
 * Pure + exported so the rule is unit-tested without rendering the form.
 *
 * Mirrors the server (hrms-service leave/domain.ts assertDayPartAllowed): a
 * half-day or short leave is only possible for Casual Leave (CL), on a single
 * date, and only when the tenant switched it on. The server stays the
 * authority -- this only avoids offering a choice it would reject.
 */
export type LeaveDayPart = "full" | "first_half" | "second_half" | "short_leave";

export type LeaveTenantConfig = { halfDayEnabled: boolean; shortLeaveEnabled: boolean };

export const NO_PART_DAY_CONFIG: LeaveTenantConfig = { halfDayEnabled: false, shortLeaveEnabled: false };

export function availableDayParts(
  cfg: LeaveTenantConfig,
  leaveTypeCode: string | undefined,
  singleDate: boolean,
): LeaveDayPart[] {
  const parts: LeaveDayPart[] = ["full"];
  if (!singleDate || (leaveTypeCode ?? "").toUpperCase() !== "CL") return parts;
  if (cfg.halfDayEnabled) parts.push("first_half", "second_half");
  if (cfg.shortLeaveEnabled) parts.push("short_leave");
  return parts;
}

/** Days the request counts for before the server confirms (whole days unless a part is chosen). */
export function daysForPart(part: LeaveDayPart, calendarDays: number): number {
  return part === "full" ? calendarDays : 0.5;
}

/** Defensive parse of GET /v1/hrms/leave-config; anything unexpected = both OFF. */
export function parseLeaveConfig(raw: unknown): LeaveTenantConfig {
  if (typeof raw !== "object" || raw === null) return NO_PART_DAY_CONFIG;
  const r = raw as Record<string, unknown>;
  return { halfDayEnabled: r.halfDayEnabled === true, shortLeaveEnabled: r.shortLeaveEnabled === true };
}
