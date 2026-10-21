/**
 * GAP-HR-ATTENDANCE-CONFIG-02: single, typed, code-reviewed source of truth
 * for the attendance engine's compiled-in policy defaults shown on
 * /hr/attendance/config. These values used to live only as literal display
 * strings in messages/en.json (e.g. attendanceConfig.whOfficeStartVal =
 * "09:30 AM") -- a translator editing a locale file could change a business
 * rule (a time, a threshold, a multiplier) with no code review at all, and
 * hi/kn/ta/te could each end up carrying silently divergent numbers with
 * nothing to catch the drift.
 *
 * Per GAP-HR-ATTENDANCE-CONFIG-01's decision (see the HR decision packet,
 * theme 5 "Unbuilt features": "Keep it read-only for now... rather than
 * build a full config-editor screen in this campaign") this stays a static,
 * compiled-in reference -- NOT a per-tenant setting read from a backend
 * config endpoint. These are the same values the page already displayed;
 * this is a refactor of WHERE they live and how change-controlled they are,
 * not a claim that they've now been freshly verified against a real
 * attendance-engine module (the catalog's own evidence: "Cannot verify
 * engine constants... no attendance-engine config module found in the
 * snapshot" -- still true after this change).
 *
 * config/page.tsx formats these into display strings (attendance/config's
 * own doc comment explains the 24h "HH:mm" convention for time fields;
 * lib/formatters.ts's formatClockTime12h renders them for display) and
 * passes them as ICU template parameters to the `attendanceConfig.*Tpl`
 * keys in every locale file, so the actual number is always code-supplied --
 * a translator can still adjust the surrounding wording/grammar per locale,
 * but can no longer silently redefine a policy value. (The keys were named
 * `*Val` while the locale files still held literal values; they are now
 * templates and renamed `*Tpl`.) attendanceConfig.messages.test.ts enforces
 * that every locale's template takes exactly the parameters the English one
 * does and carries no literal number of its own.
 *
 * The four non-numeric rows are code-supplied too, as closed codes
 * (WeeklyOffPattern / ApproverLevel / CoEarnedRule) rendered through an ICU
 * `select` in each locale, rather than English sentences passed through
 * `{value}` -- the latter would show English text on the Hindi page.
 *
 * PROVENANCE (GAP-HR-ATTENDANCE-CONFIG-01, still open): none of these values
 * has been traced to attendance-engine code. A repo-wide search of
 * services/ and packages/ finds no late-mark, OT-rate, CL-deduction or
 * comp-off constants anywhere, and hrms-service exposes no attendance
 * config endpoint. They have NOT been verified against any engine, so there
 * is no "last verified" version to record; the page banner says so. Whoever
 * owns attendance policy must confirm each value (or supply the source of
 * truth) before this reference is relied on -- that is an owner decision,
 * not something to infer here.
 */
/** Weekly-off pattern; add a code (and its `select` arm in every locale) to support another. */
export type WeeklyOffPattern = "sat_sun";
/** Who approves; add a code (and its `select` arm in every locale) to support another. */
export type ApproverLevel = "supervisor";
/** When a compensatory off is earned. */
export type CoEarnedRule = "holiday_or_weekly_off";

export interface AttendanceDefaults {
  officeStartTime: string;
  officeEndTime: string;
  graceMinutes: number;
  halfDayCutoffTime: string;
  minHoursForFullDay: number;
  weeklyOffPattern: WeeklyOffPattern;
  lateMarkGraceMinutes: number;
  lateMarkTriggerTime: string;
  halfDayIfAfterTime: string;
  absentIfNoCheckInAfterTime: string;
  lateMarksPerClDeducted: number;
  otEligibleAfterHours: number;
  otRateWeekdayMultiplier: number;
  otRateWeeklyOffMultiplier: number;
  otMaxHoursPerDay: number;
  otApprovedBy: ApproverLevel;
  coEarnedRule: CoEarnedRule;
  coMustAvailWithinDays: number;
  coMaxAccumulation: number;
  coApprovedBy: ApproverLevel;
}

export const ATTENDANCE_DEFAULTS: AttendanceDefaults = {
  officeStartTime: "09:30",
  officeEndTime: "18:00",
  graceMinutes: 15,
  halfDayCutoffTime: "12:30",
  minHoursForFullDay: 7.5,
  weeklyOffPattern: "sat_sun",
  lateMarkGraceMinutes: 15,
  lateMarkTriggerTime: "09:45",
  halfDayIfAfterTime: "12:30",
  absentIfNoCheckInAfterTime: "14:00",
  lateMarksPerClDeducted: 3,
  otEligibleAfterHours: 8.5,
  otRateWeekdayMultiplier: 1.5,
  otRateWeeklyOffMultiplier: 2,
  otMaxHoursPerDay: 4,
  otApprovedBy: "supervisor",
  coEarnedRule: "holiday_or_weekly_off",
  coMustAvailWithinDays: 30,
  coMaxAccumulation: 3,
  coApprovedBy: "supervisor",
};
