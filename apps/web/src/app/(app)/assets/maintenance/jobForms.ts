/**
 * Pure helpers for the maintenance Complete-job and Meter-reading forms.
 * Bodies mirror asset-service's completeWorkOrderBody / meterReadingBody
 * (modules/maintenance/validators.ts); the service stays authoritative.
 * Validators return message KEYS in the `assetsLifecycle` i18n namespace.
 */

/** Rupees text -> whole paise number. Blank = 0. null = invalid (negative, >2 decimals, or beyond 2^53). */
export function rupeesToPaise(input: string): number | null {
  const t = input.trim();
  if (!t) return 0;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const [, whole, frac = ""] = m;
  if (/[1-9]/.test(frac.slice(2))) return null;
  const big = BigInt(whole! + `${frac}00`.slice(0, 2));
  const n = Number(big);
  return Number.isSafeInteger(n) && BigInt(n) === big ? n : null;
}

export const METER_TYPES = ["odometer", "hours_run", "cycles", "temperature", "vibration", "custom"] as const;
export type MeterType = (typeof METER_TYPES)[number];

export type CompleteForm = { completedDate: string; cost: string; notes: string };
export type CompleteErrors = Partial<Record<"completedDate" | "cost", string>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateComplete(f: CompleteForm, today: string): CompleteErrors {
  const e: CompleteErrors = {};
  if (!DATE_RE.test(f.completedDate)) e.completedDate = "errCompletedDateRequired";
  else if (f.completedDate > today) e.completedDate = "errDateFuture";
  if (rupeesToPaise(f.cost) === null) e.cost = "errCostInvalid";
  return e;
}

export function completeBody(f: CompleteForm) {
  return {
    completedDate: f.completedDate,
    costMinor: rupeesToPaise(f.cost) ?? 0,
    currency: "INR",
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
  };
}

export type MeterForm = { meterType: MeterType; value: string; unit: string; readingDate: string; notes: string };
export type MeterErrors = Partial<Record<"value" | "unit" | "readingDate", string>>;

export function validateMeter(f: MeterForm, today: string): MeterErrors {
  const e: MeterErrors = {};
  const v = Number(f.value);
  if (!f.value.trim() || !Number.isFinite(v) || v <= 0) e.value = "errReadingInvalid";
  if (!f.unit.trim() || f.unit.trim().length > 16) e.unit = "errUnitInvalid";
  if (!DATE_RE.test(f.readingDate)) e.readingDate = "errReadingDateRequired";
  else if (f.readingDate > today) e.readingDate = "errDateFuture";
  return e;
}

export function meterBody(f: MeterForm) {
  return {
    meterType: f.meterType,
    readingValue: Number(f.value),
    unit: f.unit.trim(),
    readingDate: f.readingDate,
    source: "manual" as const,
    ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
  };
}

/** Status values a clerk can still complete. */
export function isOpenJob(status: string): boolean {
  return status === "scheduled" || status === "in_progress" || status === "overdue";
}
