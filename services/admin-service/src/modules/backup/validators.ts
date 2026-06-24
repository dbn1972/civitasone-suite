import { z } from "zod";

export const tenantIdParam = z.object({ id: z.string().uuid() });

// P1-2: validate the cron expression against a 5-field grammar and enforce a
// minimum interval. The previous validator only checked string length, so a
// malformed expression (or an every-minute schedule) was forwarded unchecked
// to scheduleBackup.
//
// Grammar: standard 5 fields — minute hour day-of-month month day-of-week.
// Each field is one of: "*", a number, a range a-b, a step */n or a-b/n, or a
// comma-separated list of the above. Field value ranges are enforced so e.g.
// minute 99 or month 13 is rejected.

const FIELD_BOUNDS: Array<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week (0 and 7 both Sunday)
];

function isValidFieldPart(part: string, min: number, max: number): boolean {
  // step: base/step
  let base = part;
  let stepStr: string | undefined;
  const slash = part.indexOf("/");
  if (slash !== -1) {
    base = part.slice(0, slash);
    stepStr = part.slice(slash + 1);
    if (!/^\d+$/.test(stepStr)) return false;
    const step = Number(stepStr);
    if (step < 1 || step > max) return false;
  }
  if (base === "*") return true;
  // range a-b
  const dash = base.indexOf("-");
  if (dash !== -1) {
    const a = base.slice(0, dash);
    const b = base.slice(dash + 1);
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
    const an = Number(a);
    const bn = Number(b);
    return an >= min && bn <= max && an <= bn;
  }
  // single number
  if (!/^\d+$/.test(base)) return false;
  const n = Number(base);
  return n >= min && n <= max;
}

function isValidField(field: string, min: number, max: number): boolean {
  if (field.length === 0) return false;
  return field.split(",").every((p) => isValidFieldPart(p, min, max));
}

/** Returns true when `expr` is a syntactically valid 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f, i) => {
    const bounds = FIELD_BOUNDS[i];
    return bounds !== undefined && isValidField(f, bounds[0], bounds[1]);
  });
}

/**
 * Enforces a minimum interval of one hour: the minute field must resolve to a
 * single fixed minute (no "*", no ranges, no lists, no sub-hourly steps).
 * Rejects every-minute / sub-hourly schedules that would hammer the backup
 * pipeline.
 */
export function meetsMinimumInterval(expr: string): boolean {
  const minute = expr.trim().split(/\s+/)[0];
  if (minute === undefined) return false;
  return /^\d{1,2}$/.test(minute) && Number(minute) >= 0 && Number(minute) <= 59;
}

export const scheduleBody = z.object({
  cronExpr: z
    .string()
    .min(5)
    .max(128)
    .refine(isValidCron, { message: "cronExpr is not a valid 5-field cron expression" })
    .refine(meetsMinimumInterval, {
      message: "cronExpr must run at most hourly (minute field must be a fixed value)",
    }),
});
