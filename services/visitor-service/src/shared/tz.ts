/**
 * visitor-service: timezone-aware day boundaries (pure, DST-safe, independent of the host TZ).
 *
 * "End of the day" for a pass used to be computed with the server's local getDate()/setHours, so on a
 * UTC host a pass for 14 Nov ended at 05:29 IST on 15 Nov. All day maths now goes through these
 * helpers with an explicit IANA zone: the tenant's (`tenant.time_zone` visitor_policy), else Asia/Kolkata.
 */
export const DEFAULT_TIME_ZONE = "Asia/Kolkata";

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The tenant's zone if it is a valid IANA name, else Asia/Kolkata. */
export function resolveTimeZone(tz: unknown): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

interface Ymd { y: number; m: number; d: number }

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Calendar date of `d` in `tz`, plus the zone's offset (ms, local - UTC) at that instant. */
function zoned(d: Date, tz: string): Ymd & { offsetMs: number } {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(d)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return { y: p.year!, m: p.month!, d: p.day!, offsetMs: asUtc - Math.floor(d.getTime() / 1000) * 1000 };
}

/** The instant at which the local wall-clock date y-m-d 00:00:00 occurs in `tz`. */
function localMidnight({ y, m, d }: Ymd, tz: string): Date {
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoned(new Date(wall), tz).offsetMs;
  guess = wall - zoned(new Date(guess), tz).offsetMs; // second pass settles across a DST change
  return new Date(guess);
}

/** 00:00:00.000 local time on the day containing `d`. */
export function startOfDayInZone(d: Date, tz: string = DEFAULT_TIME_ZONE): Date {
  const { y, m, d: day } = zoned(d, tz);
  return localMidnight({ y, m, d: day }, tz);
}

/** 23:59:59.999 local time on the day containing `d`. */
export function endOfDayInZone(d: Date, tz: string = DEFAULT_TIME_ZONE): Date {
  const { y, m, d: day } = zoned(d, tz);
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  return new Date(
    localMidnight({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() }, tz).getTime() - 1,
  );
}
