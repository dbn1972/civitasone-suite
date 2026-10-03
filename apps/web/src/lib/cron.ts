import { formatClockTime12h } from "@/lib/formatters";

/**
 * Plain-language rendering of a 5-field cron expression for the scheduled-jobs
 * registry (GAP-ADMIN-SCHEDULED-JOBS-06). Only the shapes the create form
 * offers (and their obvious siblings) are humanised; anything else is
 * returned verbatim so the operator sees the real expression rather than an
 * invented description. Display only: the stored expression is never altered.
 */
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isInt(v: string | undefined, min: number, max: number): v is string {
  return v !== undefined && /^\d{1,2}$/.test(v) && Number(v) >= min && Number(v) <= max;
}

export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") return "Every hour";
  const step = /^\*\/(\d{1,2})$/.exec(min ?? "");
  // A step is only humanised when it is a valid one (minutes 1-59); `*/0`, `*/75` stay raw.
  if (step && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(step[1]);
    if (n < 1 || n > 59) return cron;
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  const hourStep = /^\*\/(\d{1,2})$/.exec(hour ?? "");
  if (hourStep && isInt(min, 0, 59) && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(hourStep[1]);
    if (n < 1 || n > 23) return cron;
    return n === 1 ? `Every hour at minute ${Number(min)}` : `Every ${n} hours at minute ${Number(min)}`;
  }

  // Everything below needs a fixed clock time; steps, lists and ranges in
  // minute/hour fall back to the raw expression.
  if (!isInt(min, 0, 59) || !isInt(hour, 0, 23)) return cron;
  const at = formatClockTime12h(`${hour.padStart(2, "0")}:${min.padStart(2, "0")}`);

  if (mon !== "*") return cron;
  if (dom === "*" && dow === "*") return `Every day at ${at}`;
  if (dom === "1" && dow === "*") return `1st of every month at ${at}`;
  if (dom === "*" && dow === "1-5") return `Weekdays at ${at}`;
  if (dom === "*" && /^[0-7]$/.test(dow ?? "")) return `Every ${WEEKDAY_NAMES[Number(dow) % 7]} at ${at}`;
  return cron;
}
