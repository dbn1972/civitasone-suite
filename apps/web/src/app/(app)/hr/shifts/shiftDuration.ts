/**
 * GAP-HR-SHIFTS-02: format a whole number of minutes for the shift register.
 * The API (attendance/repo.ts listShifts) returns plain numeric
 * graceMinutes / workingMinutes; the web layer owns the wording so it is
 * localised (shifts.durationMinutes / shifts.durationHoursMinutes) rather
 * than hard-coded English.
 *
 *   formatShiftDuration(15, t)  -> "15 min"
 *   formatShiftDuration(0, t)   -> "0 min"   (a zero grace period is real data)
 *   formatShiftDuration(480, t) -> "8h 0m"   (a 22:00-06:00 night shift)
 *   formatShiftDuration(510, t) -> "8h 30m"
 *   formatShiftDuration(null, t) -> "—"      (absent, not zero)
 */
export type ShiftDurationTranslator = (
  key: "durationMinutes" | "durationHoursMinutes",
  values: { hours?: number; minutes: number },
) => string;

export function formatShiftDuration(minutes: number | null | undefined, t: ShiftDurationTranslator): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return "—";
  const whole = Math.round(minutes);
  if (whole < 60) return t("durationMinutes", { minutes: whole });
  return t("durationHoursMinutes", { hours: Math.floor(whole / 60), minutes: whole % 60 });
}
