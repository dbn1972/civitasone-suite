/**
 * GAP-PAYROLL-PAY-GROUPS-01: pure helpers for a pay group's pay-day, so the
 * form and the card agree on what each frequency means. Mirrors payroll-service
 * (modules/payroll/fin03-domain.ts): ISO weekdays 1 (Monday) .. 7 (Sunday),
 * bi-weekly parity 1 = odd ISO weeks / 0 = even ISO weeks, "last day of the
 * month" for monthly groups.
 */
export type PayFrequency = "monthly" | "bi_weekly" | "weekly";

export type PayScheduleInput = {
  frequency: PayFrequency;
  /** Monthly: 1-31. Ignored for weekly / bi-weekly. */
  dayOfMonth: number;
  lastDay: boolean;
  /** ISO weekday 1-7; weekly / bi-weekly. */
  weekday: number | null;
  /** Bi-weekly only: 1 odd ISO weeks, 0 even. */
  parity: number | null;
};

export type PayScheduleFields = {
  frequency: PayFrequency;
  payDayOfMonth?: number;
  payLastDay: boolean;
  payWeekday: number | null;
  payWeekParity: number | null;
};

/** The API fields for a schedule; fields that do not apply to the frequency are sent as null / false (clears them on an edit). */
export function payScheduleFields(s: PayScheduleInput): PayScheduleFields {
  if (s.frequency === "monthly") {
    return { frequency: "monthly", payDayOfMonth: s.dayOfMonth, payLastDay: s.lastDay, payWeekday: null, payWeekParity: null };
  }
  if (s.frequency === "weekly") {
    return { frequency: "weekly", payLastDay: false, payWeekday: s.weekday, payWeekParity: null };
  }
  return { frequency: "bi_weekly", payLastDay: false, payWeekday: s.weekday, payWeekParity: s.parity };
}

/** A problem with the schedule as a message KEY of the form's namespace, or null. */
export function payScheduleProblem(s: PayScheduleInput): "dayRangeError" | "weekdayRequiredError" | "parityRequiredError" | null {
  if (s.frequency === "monthly") {
    if (s.lastDay) return null;
    return Number.isInteger(s.dayOfMonth) && s.dayOfMonth >= 1 && s.dayOfMonth <= 31 ? null : "dayRangeError";
  }
  if (s.weekday == null || s.weekday < 1 || s.weekday > 7) return "weekdayRequiredError";
  if (s.frequency === "bi_weekly" && s.parity !== 0 && s.parity !== 1) return "parityRequiredError";
  return null;
}

/** Locale weekday name for an ISO weekday (1 = Monday). */
export function weekdayName(isoWeekday: number, locale: string): string {
  // 2024-01-01 was a Monday.
  const d = new Date(Date.UTC(2024, 0, isoWeekday));
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(d);
  }
}

export type PayDayDescription =
  | { kind: "lastDay" }
  | { kind: "dayOfMonth"; day: number }
  | { kind: "weekday"; weekday: number }
  | { kind: "biWeekly"; weekday: number; parity: number | null }
  /** Weekly / bi-weekly group created before weekdays existed: only a day-of-month is stored. */
  | { kind: "legacyDay"; day: number };

export function describePayDay(g: {
  frequency: string;
  payDayOfMonth: number;
  payWeekday?: number | null | undefined;
  payLastDay?: boolean | null | undefined;
  payWeekParity?: number | null | undefined;
}): PayDayDescription {
  if (g.frequency === "monthly") {
    return g.payLastDay ? { kind: "lastDay" } : { kind: "dayOfMonth", day: g.payDayOfMonth };
  }
  if (g.payWeekday != null) {
    return g.frequency === "bi_weekly"
      ? { kind: "biWeekly", weekday: g.payWeekday, parity: g.payWeekParity ?? null }
      : { kind: "weekday", weekday: g.payWeekday };
  }
  return { kind: "legacyDay", day: g.payDayOfMonth };
}
