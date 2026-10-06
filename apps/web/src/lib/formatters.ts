const IST_TIME_ZONE = "Asia/Kolkata";
const BARE_CALENDAR_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when `value` is a bare calendar-date string like "2024-03-31" -- no
 * time component, no "T", no offset. A bare calendar date names a *day*, not
 * an instant, so it has no timezone to convert: "2024-03-31" means the same
 * calendar day everywhere. A full ISO timestamp such as
 * "2024-03-31T18:30:00.000Z" names an instant, and DOES need to be resolved
 * to its Asia/Kolkata calendar day before display. Getting this distinction
 * backwards is a real, previously-reported bug: converting a bare date "as
 * if" it were a UTC instant can shift it onto the wrong day.
 */
function isBareCalendarDate(value: string): boolean {
  return BARE_CALENDAR_DATE_RE.test(value);
}

/**
 * A Date's calendar day *as seen in* `timeZone`, as "YYYY-MM-DD". Used
 * internally to move a real instant onto its IST (or UTC) calendar day before
 * doing pure Y/M/D arithmetic on it, and as the basis for display formatting
 * below.
 */
function datePartsInZone(d: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The IST calendar-date part of a value that may be a bare date ("2026-03-11")
 * or a full ISO instant ("2026-03-10T19:00:00.000Z"). A bare date names a day
 * and is returned as-is; an instant is resolved to its IST day. Lets a "due
 * today" comparison (GAP-CRM-ACTIVITIES-03) work whether the backend sends a
 * date or a timestamp. Pairs with the existing todayIST() below.
 */
export function istDatePart(value: string | null | undefined): string | null {
  if (!value) return null;
  if (isBareCalendarDate(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : datePartsInZone(d, IST_TIME_ZONE);
}

// Fixed 3-letter month table for "dd Mon yyyy" display -- deliberately NOT
// `toLocaleDateString(..., { month: "short" })`. Recent CLDR English data
// renders September as "Sept" (four letters) while every other month stays
// three, which would make this format inconsistently 3-or-4 letters
// depending on the month, and could silently shift again with the runtime's
// ICU/CLDR version. A fixed table keeps every month exactly three letters,
// deterministically, matching how "dd Mon yyyy" is actually specified.
const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "dd Mon yyyy" (e.g. "28 Sep 2026") for a real instant, resolved in `timeZone`. */
function formatDateInZone(d: Date, timeZone: string): string {
  const [y, m, day] = datePartsInZone(d, timeZone).split("-");
  return `${day} ${SHORT_MONTH_NAMES[Number(m) - 1]} ${y}`;
}

/**
 * Indian date-format standard (decided under HR gap-remediation gap SF-07):
 * "dd Mon yyyy", e.g. "28 Sep 2026" -- replacing the platform's previous
 * dd/MM/yyyy rendering.
 *
 * NOTE ON THE PRIOR dd/MM/yyyy FORMAT: this function (and its test file)
 * previously cited "GFR 2017 / PFMS mandate" as the reason for dd/MM/yyyy.
 * That citation is not re-verified as part of this change -- SF-07's decision
 * packet framed this as a UX/consistency call, not a statutory-format review.
 * If dd/MM/yyyy turns out to be a genuine external filing/interop requirement
 * (GFR 2017, PFMS, or otherwise) rather than just this app's own display
 * convention, that is a separate compliance question worth confirming
 * explicitly before this ships beyond a reviewed PR.
 *
 * Also fixes a separate, independently-real bug: this function used to call
 * toLocaleDateString with no explicit `timeZone`, so a date near midnight
 * could render as the wrong calendar day depending on the server's local
 * clock/TZ. It now always resolves a real timestamp via Asia/Kolkata.
 *
 * A bare "YYYY-MM-DD" calendar-date string (no time component -- several
 * callers pass one, e.g. after `.slice(0, 10)`) is formatted literally, with
 * no timezone conversion: it has no time component to convert. A full ISO
 * timestamp is treated as an instant and converted to its Asia/Kolkata
 * calendar day first. See isBareCalendarDate() above.
 *
 *   formatIndianDate("2024-03-31")                  -> "31 Mar 2024"
 *   formatIndianDate("2024-01-15T19:00:00.000Z")     -> "16 Jan 2024" (IST rollover)
 *   formatIndianDate(null)                            -> "—"
 */
export function formatIndianDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  if (isBareCalendarDate(isoDate)) {
    const [y, m, d] = isoDate.split("-").map(Number);
    const asUtcMidnight = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(asUtcMidnight.getTime())) return isoDate;
    return formatDateInZone(asUtcMidnight, "UTC");
  }
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  return formatDateInZone(d, IST_TIME_ZONE);
}

/**
 * GAP-TENANT-ADMIN-IDP-03: show only the scheme+host of an identity-provider
 * endpoint so a realm path, bind details, userinfo, or query string are not
 * exposed in the table or CSV. For a value that does not parse as a URL
 * (e.g. an ldaps host:port), the host[:port] portion before the first path
 * separator is returned. Empty/invalid → "—".
 *
 *   endpointOrigin("https://user:pw@idp.example/realms/x?a=b") -> "https://idp.example"
 *   endpointOrigin("ldaps://ldap.example:636/dc=x")            -> "ldaps://ldap.example:636"
 *   endpointOrigin("")                                          -> "—"
 */
export function endpointOrigin(endpoint: string | null | undefined): string {
  if (!endpoint || !endpoint.trim()) return "—";
  const value = endpoint.trim();
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    // Not a parseable URL: strip any scheme, userinfo, path and query by hand.
    const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/)/i.exec(value);
    const scheme = schemeMatch ? schemeMatch[1] : "";
    let rest = value.slice(scheme.length);
    const at = rest.indexOf("@");
    if (at >= 0) rest = rest.slice(at + 1);
    rest = rest.split(/[/?#]/)[0];
    return rest ? `${scheme}${rest}` : "—";
  }
}

/**
 * GAP-TENANT-ADMIN-IDP-03: a date+time in Asia/Kolkata with an explicit "IST"
 * suffix, for tables where the raw `toLocaleString` output (no timeZone, no
 * label) would render in the viewer's own zone and could not be told apart
 * from UTC. Returns "—" for null/invalid rather than "Invalid Date".
 *
 *   formatDateTimeIST("2026-09-29T00:00:00Z") -> "29 Sep 2026, 05:30 am IST"
 *   formatDateTimeIST("")                       -> "—"
 */
export function formatDateTimeIST(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "—";
  const datePart = formatDateInZone(d, IST_TIME_ZONE);
  const timePart = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST_TIME_ZONE });
  return `${datePart}, ${timePart} IST`;
}

/**
 * GAP-TENANT-ADMIN-BREAKGLASS-03: elapsed duration between two instants as a
 * compact "Xh Ym" / "Ym" / "Xd Yh" string. When `endedAt` is omitted the
 * duration runs to `now` (defaulting to the current time) — used to show a
 * live "ongoing" elapsed time. Returns "—" for a missing/invalid start, and
 * "0m" for a non-positive span (clock skew / same instant).
 *
 *   formatDuration("2026-01-01T10:00:00Z", "2026-01-01T12:15:00Z") -> "2h 15m"
 *   formatDuration("2026-01-01T10:00:00Z", "2026-01-01T10:00:30Z") -> "0m"
 */
export function formatDuration(
  startedAt: string | null | undefined,
  endedAt?: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return "—";
  const end = endedAt ? new Date(endedAt) : now;
  if (isNaN(end.getTime())) return "—";
  let totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
  if (totalMinutes <= 0) return "0m";
  const days = Math.floor(totalMinutes / 1440);
  totalMinutes -= days * 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

/**
 * Like formatIndianDate, but for a value that also carries a time of day
 * (e.g. an interview slot, "last active at") -- "dd Mon yyyy, hh:mm am/pm",
 * always resolved via Asia/Kolkata. Unlike formatIndianDate there is no bare
 * "calendar date, no time" case to special-case here: a date+time formatter
 * is only ever meaningful for a value that actually carries a time, i.e. a
 * real instant, so it is always converted.
 *
 *   formatIndianDateTime("2024-01-15T19:00:00.000Z") -> "16 Jan 2024, 12:30 am"
 *   formatIndianDateTime(null)                         -> "—"
 */
export function formatIndianDateTime(isoStringOrDate: string | Date | null | undefined): string {
  if (!isoStringOrDate) return "—";
  const d = isoStringOrDate instanceof Date ? isoStringOrDate : new Date(isoStringOrDate);
  if (isNaN(d.getTime())) return typeof isoStringOrDate === "string" ? isoStringOrDate : "—";
  const datePart = formatDateInZone(d, IST_TIME_ZONE);
  const timePart = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST_TIME_ZONE });
  return `${datePart}, ${timePart}`;
}

/**
 * GAP-BILLING-INVOICES-DETAIL-02: the NIC e-invoice cancellation window is 24h
 * from the IRN acknowledgement (ackDate). Returns the deadline Date, or null
 * when ackDate is missing/unparseable (caller then treats the window as unknown
 * and lets the server decide, rather than hard-blocking). The server remains
 * authoritative; this is only to disable the button and show honest copy before
 * a doomed round-trip.
 *
 *   irnCancelDeadline("2026-07-02T10:00:00.000Z") -> Date(2026-07-03T10:00:00.000Z)
 *   irnCancelDeadline(null)                         -> null
 */
export function irnCancelDeadline(ackDate: string | null | undefined): Date | null {
  if (!ackDate) return null;
  const d = new Date(ackDate);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Today's calendar date in Asia/Kolkata, as "YYYY-MM-DD" -- the same
 * date-only shape the codebase's own date-comparison logic already uses
 * everywhere (e.g. `new Date().toISOString().slice(0, 10)` /
 * `.split("T")[0]`, repeated across hr/confirmation, hr/onboarding,
 * hr/transfer and elsewhere, for "is this overdue" checks and date-input
 * min/max bounds). That existing pattern computes "today" in UTC, which is
 * quietly wrong for the first 5.5 hours of every IST calendar day. todayIST()
 * is the IST-correct drop-in: same "YYYY-MM-DD" string shape, so existing
 * string comparisons (e.g. `dueDate < todayIST()`) keep working unchanged.
 *
 *   todayIST() -> "2026-09-29"  (whatever the IST calendar date is "now")
 */
export function todayIST(): string {
  return datePartsInZone(new Date(), IST_TIME_ZONE);
}

/**
 * GAP-HR-DASHBOARD-08: pure, hour-in/greeting-out so it's unit-testable with
 * no Date/timezone mocking (see page.test.tsx). Replaces the previous
 * `dayName.startsWith("S") ? "Good day" : "Good morning"` weekday hack
 * entirely -- that never reflected the actual time of day, only whether
 * today happened to be a Saturday/Sunday.
 */
export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The real current hour in Asia/Kolkata, 0-23. Uses hourCycle:"h23" (not
 * hour12:false) specifically to avoid a known ICU quirk where hour12:false
 * can render midnight as "24" instead of "0" on some Node/ICU builds; the
 * `% 24` is a defensive belt-and-suspenders clamp against that same quirk
 * however it manifests.
 */
export function currentIstHour(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hourPart = parts.find((p) => p.type === "hour");
  const hour = hourPart ? parseInt(hourPart.value, 10) : new Date().getHours();
  return Number.isFinite(hour) ? hour % 24 : new Date().getHours();
}

/**
 * Add (or, with a negative `days`, subtract) whole calendar days to `date` in
 * Asia/Kolkata, returning the result as a "YYYY-MM-DD" string -- the same
 * shape as todayIST(), so the two compose directly, e.g. a form's `max` date
 * is `addDaysIST(todayIST(), 30)`.
 *
 * `date` may be a bare "YYYY-MM-DD" calendar-date string, a full ISO
 * timestamp, or a Date. A bare date's literal Y/M/D is used as-is (nothing to
 * convert); a timestamp/Date is first resolved to its Asia/Kolkata calendar
 * day, exactly as in formatIndianDate/isBareCalendarDate above. Returns "—"
 * for missing/invalid input, matching this file's UX-006 convention
 * (missing is not zero, and here, not "today" either).
 *
 *   addDaysIST("2026-09-29", 7)   -> "2026-10-06"
 *   addDaysIST("2026-09-29", -7)  -> "2026-09-22"
 *   addDaysIST(null, 7)            -> "—"
 */
export function addDaysIST(date: string | Date | null | undefined, days: number): string {
  if (!date) return "—";
  let y: number, m: number, d: number;
  if (typeof date === "string" && isBareCalendarDate(date)) {
    [y, m, d] = date.split("-").map(Number);
  } else {
    const parsed = date instanceof Date ? date : new Date(date);
    if (isNaN(parsed.getTime())) return "—";
    [y, m, d] = datePartsInZone(parsed, IST_TIME_ZONE).split("-").map(Number);
  }
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * GAP-HR-CONFIRMATION-06: whole calendar days from today (Asia/Kolkata)
 * until `isoDate`, comparing calendar DATES rather than a raw clock-time
 * diff. The bug this replaces: several call sites independently computed
 * `Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000)` --
 * a moving-clock-time diff that silently shifts by a day depending on what
 * time of day the request runs, and disagreed with a separate UTC
 * string-compare (`dueDate < todayIsoString`) done elsewhere for the exact
 * same date. A bare "YYYY-MM-DD" calendar-date string (what every API in
 * this codebase sends for a due/effective date) needs no timezone
 * conversion at all -- it already names one specific day; only a full ISO
 * timestamp is resolved to its Asia/Kolkata calendar day first.
 *
 * Returns null for a missing/unparseable date so callers can render an
 * explicit "Date not set" bucket instead of miscounting it as some number
 * of days away (previously: silently counted as "Timely").
 *
 *   daysUntilIST("2026-03-01") when "now" is 2026-03-01T19:00:00.000Z
 *   (00:30 IST on 2026-03-02) -> -1 (one day overdue)
 *   daysUntilIST(null) -> null
 */
export function daysUntilIST(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(isoDate);
  let targetDateOnly: string;
  if (isBareDate) {
    targetDateOnly = isoDate;
  } else {
    const parsed = new Date(isoDate);
    if (isNaN(parsed.getTime())) return null;
    targetDateOnly = new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const todayDateOnly = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const targetMs = new Date(`${targetDateOnly}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${todayDateOnly}T00:00:00.000Z`).getTime();
  if (isNaN(targetMs)) return null;
  return Math.round((targetMs - todayMs) / 86_400_000);
}

/**
 * Format an internal cross-service reference (e.g. financeBills.poRef, of the
 * shape "procurement_po:<uuid>") for display, or "—" when genuinely absent.
 *
 * Also guards against a malformed ref that LOOKS present but isn't: a
 * producer-side bug once template-literal-built these with string
 * interpolation and no check that the interpolated id was actually
 * defined,
 * which JS happily stringifies as the literal text "procurement_po:undefined"
 * — a real, non-null, non-empty string that would otherwise sail past a
 * plain `ref ?? "—"` check and render on screen looking like a broken
 * internal id. Treat that shape the same as a genuinely missing ref.
 *
 *   formatInternalRef("procurement_po:abc-123")   -> "procurement_po:abc-123"
 *   formatInternalRef("procurement_po:undefined") -> "—"
 *   formatInternalRef(null)                        -> "—"
 */
export function formatInternalRef(ref: string | null | undefined): string {
  if (!ref || ref === "undefined" || ref.endsWith(":undefined")) return "—";
  return ref;
}

/**
 * Utilisation as a percentage to ONE decimal (so 100.3% is not shown as a
 * reassuring "100%"), computed in BigInt. null when there is no positive
 * outlay. Use isOverUtilised() -- never this rounded figure -- to decide
 * whether to flag a scheme.
 *
 *   utilisationPercent("1003", "1000") -> 100.3
 *   utilisationPercent("400", "1000")  -> 40
 */
export function utilisationPercent(
  utilised: bigint | number | string | null | undefined,
  outlay: bigint | number | string | null | undefined,
): number | null {
  try {
    if (utilised === null || utilised === undefined || outlay === null || outlay === undefined) return null;
    const n = BigInt(utilised);
    const d = BigInt(outlay);
    if (d <= 0n || n < 0n) return null;
    return Number((n * 2000n + d) / (2n * d)) / 10;
  } catch {
    return null;
  }
}

/** Exact over-utilisation test: spend strictly above a positive outlay (BigInt, never the rounded %). */
export function isOverUtilised(
  utilised: bigint | number | string | null | undefined,
  outlay: bigint | number | string | null | undefined,
): boolean {
  try {
    if (utilised === null || utilised === undefined || outlay === null || outlay === undefined) return false;
    const d = BigInt(outlay);
    return d > 0n && BigInt(utilised) > d;
  } catch {
    return false;
  }
}

/**
 * GAP-FINANCE-EXPENDITURE-BILLS-06: a polymorphic cross-service reference such
 * as "procurement_po:5b1c2d3e-..." is machine plumbing -- the "type:" prefix and
 * a full UUID mean nothing to a clerk. Show the entity kind plus a short id
 * ("PO 5b1c2d3e") instead; a non-UUID id (a human PO number) is shown as-is.
 * Missing / "undefined" refs render "—" exactly as formatInternalRef does.
 *
 *   formatEntityRef("procurement_po:5b1c2d3e-0000-4000-8000-000000000000") -> "PO 5b1c2d3e"
 *   formatEntityRef("procurement_grn:PO-2026-014")                          -> "PO-2026-014"
 *   formatEntityRef("grn-7")                                               -> "grn-7"
 */
const ENTITY_REF_KIND: Record<string, string> = {
  procurement_po: "PO",
  procurement_grn: "GRN",
};
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatEntityRef(ref: string | null | undefined): string {
  const clean = formatInternalRef(ref);
  if (clean === "—") return clean;
  const idx = clean.indexOf(":");
  if (idx < 0) return clean;
  const kind = clean.slice(0, idx);
  const id = clean.slice(idx + 1);
  if (!id) return "—";
  if (UUID_ID.test(id)) return `${ENTITY_REF_KIND[kind] ?? humanizeStatus(kind)} ${id.slice(0, 8)}`;
  return id;
}

/**
 * Humanize a raw lowercase/snake_case status or enum value for display, e.g.
 * for a StatusPill/StatCard that was not given an explicit hand-written
 * label. "pending" -> "Pending", "pending_approval" -> "Pending Approval",
 * "na" -> "N/A". This is a generic fallback, not a replacement for a
 * hand-written label where the generic Title Case would read oddly (e.g.
 * "converted_to_po" -> "Converted To Po" instead of "Converted to PO") --
 * callers that need exact wording should keep passing their own label.
 */
const STATUS_ACRONYM_LABELS: Record<string, string> = {
  na: "N/A",
  // GAP-FINANCE-EXPENDITURE-GUARANTEES-05: treasury.finance_guarantees.type is
  // bg | pbg | performance | advance (and EMD on the procurement surface); the
  // generic Title Case would print "Bg" / "Pbg" / "Emd".
  bg: "BG",
  pbg: "PBG",
  emd: "EMD",
};

export function humanizeStatus(status: string): string {
  const key = status.trim().toLowerCase();
  if (STATUS_ACRONYM_LABELS[key]) return STATUS_ACRONYM_LABELS[key];
  return key
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-02: `numerator / denominator`
 * as a whole-number percentage, computed in BigInt so paise values above 2^53
 * stay exact (never `Number(minor)` division). Rounds half-up to the nearest
 * whole percent. Returns null when the denominator is missing / not a positive
 * integer string (so callers can render "—" rather than a fabricated 0%), and
 * null when either side is not a base-10 integer.
 *
 *   percentOfMinor("120", "100")  -> 120
 *   percentOfMinor("1", "0")      -> null
 *   percentOfMinor("9007199254740993", "9007199254740993") -> 100
 */
export function percentOfMinor(
  numerator: bigint | number | string | null | undefined,
  denominator: bigint | number | string | null | undefined,
): number | null {
  try {
    if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) return null;
    const n = BigInt(numerator);
    const d = BigInt(denominator);
    if (d <= 0n || n < 0n) return null;
    // (n * 100 * 2 + d) / (2d) == round-half-up of n*100/d, all in BigInt.
    return Number((n * 200n + d) / (2n * d));
  } catch {
    return null;
  }
}

/**
 * GAP-HR-ATTENDANCE-CONFIG-02: formats a 24h "HH:mm" time (the shape
 * attendance policy defaults are now stored in, lib/attendanceDefaults.ts)
 * as a 12h clock string for display, e.g. for the attendance-rules
 * reference page's "Office start time" / "Late mark trigger" rows -- moves
 * this formatting out of hand-written *Val strings in messages/*.json (a
 * translator could previously change "09:30 AM" to any other time with no
 * code review) so the source of truth is the typed constant, not a
 * translatable string.
 *
 *   formatClockTime12h("09:30") -> "09:30 AM"
 *   formatClockTime12h("18:00") -> "06:00 PM"
 *   formatClockTime12h("00:05") -> "12:05 AM"
 *   formatClockTime12h("bad")   -> "bad" (unparseable input passed through, not hidden)
 */
export function formatClockTime12h(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  const hour24 = Number(match[1]);
  const minute = match[2];
  if (hour24 > 23) return hhmm;
  const period = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12).padStart(2, "0")}:${minute} ${period}`;
}

/**
 * Format money already expressed in RUPEES (not paise) as a ₹ string with en-IN
 * (lakh/crore) grouping and 2 decimals. Use this for the few API fields that return
 * rupees rather than minor units (e.g. payroll-runs grossAmount/netAmount). Do NOT
 * pass a rupee value to formatMoney() — that treats it as paise and shows 100x too small.
 *
 * UX-006: null/undefined/non-finite is MISSING data, not a real zero — it renders
 * "—" (same convention as formatBps/formatIndianDate), never a fabricated ₹0.00.
 *
 *   formatRupees(90000)   -> "₹90,000.00"
 *   formatRupees(null)    -> "—"
 *   formatRupees(NaN)     -> "—"
 */
export function formatRupees(rupees: number | string | null | undefined): string {
  if (rupees === null || rupees === undefined || rupees === "") return "—";
  const n = typeof rupees === "number" ? rupees : Number(rupees);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format money held in MINOR units (paise) as a ₹ string with en-IN (lakh/crore)
 * grouping and exactly 2 decimal places. Paise-correct: works on bigint, number,
 * or numeric string without floating-point drift on the rupee/paise split.
 *
 * UX-006: null/undefined/empty/unparseable is MISSING data, not a real zero — it
 * renders "—" (same convention as formatBps/formatIndianDate), never a fabricated
 * ₹0.00 that would be indistinguishable from a genuine zero-rupee amount.
 *
 *   formatMoney(123456789n)  -> "₹12,34,567.89"
 *   formatMoney(100)         -> "₹1.00"
 *   formatMoney("-2550")     -> "-₹25.50"
 *   formatMoney(null)        -> "—"
 *   formatMoney(undefined)   -> "—"
 *   formatMoney("garbage")   -> "—"
 */
export function formatMoney(minorUnits: bigint | number | string | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") return "—";

  let minor: bigint;
  try {
    if (typeof minorUnits === "bigint") {
      minor = minorUnits;
    } else if (typeof minorUnits === "number") {
      if (!Number.isFinite(minorUnits)) return "—";
      // Round to the nearest paisa to absorb any float imprecision before BigInt.
      minor = BigInt(Math.round(minorUnits));
    } else {
      const trimmed = minorUnits.trim();
      if (trimmed === "") return "—";
      if (/^[+-]?\d+$/.test(trimmed)) {
        minor = BigInt(trimmed);
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return "—";
        minor = BigInt(Math.round(n));
      }
    }
  } catch {
    return "—";
  }

  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;

  const rupeesStr = rupees.toString();
  // Indian grouping: last 3 digits, then groups of 2.
  let grouped: string;
  if (rupeesStr.length <= 3) {
    grouped = rupeesStr;
  } else {
    const head = rupeesStr.slice(0, rupeesStr.length - 3);
    const tail = rupeesStr.slice(rupeesStr.length - 3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }

  const paiseStr = paise.toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${grouped}.${paiseStr}`;
}

/**
 * GAP-CRM-CAMPAIGNS-DETAIL-03: format money held in MINOR units in a SPECIFIC
 * ISO-4217 currency. `formatMoney` hard-codes ₹ and the Indian lakh/crore
 * grouping, so passing a USD or EUR amount through it prints a rupee symbol on
 * a foreign figure. Use this wherever the amount carries its own currency code
 * (campaign ROI rows carry `currency`).
 *
 * The minor-unit exponent is taken from the currency itself (most are 2, JPY/KRW
 * are 0, some Gulf currencies are 3) via Intl, so the paise/cents split is right
 * for the currency rather than always assuming 2. INR output matches formatMoney
 * (₹ + en-IN grouping). An unknown 3-letter code falls back to 2 decimals and the
 * code as the symbol rather than throwing; null/empty/unparseable renders "—"
 * (same UX-006 convention as formatMoney).
 *
 *   formatMoneyIn("12345", "USD") -> "$123.45"
 *   formatMoneyIn("12345", "INR") -> "₹123.45"
 *   formatMoneyIn("12345", "JPY") -> "¥12,345"
 *   formatMoneyIn(null, "USD")    -> "—"
 */
export function formatMoneyIn(
  minorUnits: bigint | number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const code = (currency ?? "").trim().toUpperCase();
  // No/invalid currency code: fall back to the INR formatter's "—" / ₹ behaviour.
  if (!/^[A-Z]{3}$/.test(code)) return formatMoney(minorUnits);
  if (code === "INR") return formatMoney(minorUnits);
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") return "—";

  let minor: bigint;
  try {
    if (typeof minorUnits === "bigint") {
      minor = minorUnits;
    } else if (typeof minorUnits === "number") {
      if (!Number.isFinite(minorUnits)) return "—";
      minor = BigInt(Math.round(minorUnits));
    } else {
      const trimmed = minorUnits.trim();
      if (trimmed === "") return "—";
      if (/^[+-]?\d+$/.test(trimmed)) minor = BigInt(trimmed);
      else {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return "—";
        minor = BigInt(Math.round(n));
      }
    }
  } catch {
    return "—";
  }

  // Minor-unit exponent for the currency (2 for most, 0 for JPY, 3 for e.g. KWD).
  let fractionDigits = 2;
  try {
    const resolved = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions();
    if (typeof resolved.maximumFractionDigits === "number") fractionDigits = resolved.maximumFractionDigits;
  } catch {
    fractionDigits = 2;
  }

  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = 10n ** BigInt(fractionDigits);
  // major.minor as a Number is only used by Intl for grouping/symbol; the exact
  // integer split is done in BigInt above so no paise are lost before display.
  const major = abs / divisor;
  const fraction = abs % divisor;
  const asNumber = Number(`${major}.${fraction.toString().padStart(fractionDigits, "0")}`);
  try {
    const formatted = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(asNumber);
    return negative ? `-${formatted}` : formatted;
  } catch {
    // Unknown code: show the code as a prefix rather than a wrong symbol.
    const fractionStr = fractionDigits > 0 ? `.${fraction.toString().padStart(fractionDigits, "0")}` : "";
    return `${negative ? "-" : ""}${code} ${major.toString()}${fractionStr}`;
  }
}

/**
 * GAP-PROJECTS-UTILIZATION-03: format a MINOR-unit (paise) amount as a
 * ₹-crore string with 2 decimals, e.g. for a fund-utilization table whose
 * columns are headed "(₹ Cr)". Computed in BigInt (never Number(bigint)/1e9)
 * so values above 2^53 paise stay exact; rounds half-up to 2 decimals of a
 * crore. null/empty/unparseable renders "—" (UX-006), never a fabricated
 * ₹0.00 Cr.
 *
 *   formatCrore("34500000000")  -> "₹345.00 Cr"   (₹345 crore)
 *   formatCrore("185000000000") -> "₹1,850.00 Cr"
 *   formatCrore(null)           -> "—"
 */
export function formatCrore(minorUnits: bigint | number | string | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") return "—";
  let minor: bigint;
  try {
    if (typeof minorUnits === "bigint") minor = minorUnits;
    else if (typeof minorUnits === "number") {
      if (!Number.isFinite(minorUnits)) return "—";
      minor = BigInt(Math.round(minorUnits));
    } else {
      const t = minorUnits.trim();
      if (!/^[+-]?\d+$/.test(t)) return "—";
      minor = BigInt(t);
    }
  } catch {
    return "—";
  }
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const CRORE = 1_000_000_000n; // 1 crore rupees in paise
  // hundredths of a crore, rounded half-up.
  const hundredths = (abs * 100n + CRORE / 2n) / CRORE;
  const whole = (hundredths / 100n).toString();
  // Indian grouping on the integer-crore part.
  let grouped: string;
  if (whole.length <= 3) grouped = whole;
  else {
    const head = whole.slice(0, whole.length - 3);
    const tail = whole.slice(whole.length - 3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  const frac = (hundredths % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${grouped}.${frac} Cr`;
}

/**
 * GAP-FINANCE-BUDGET-ALLOCATION-05: compact "Cr / L" shorthand for stat cards
 * and summary figures (>= 1 lakh rupees), computed in bigint -- never via
 * Number(bigint)/100. Below 1 lakh it falls back to the exact formatMoney()
 * (paise included), so a small amount never loses its paise. Tables and
 * exports must keep using formatMoney() so reconciliation figures stay exact.
 *
 *   (1 lakh = 10,000,000 paise; 1 crore = 1,000,000,000 paise)
 *   formatMoneyCompact(530000000n) -> "₹53.00 L"
 *   formatMoneyCompact(1800000000n) -> "₹1.80 Cr"
 *   formatMoneyCompact(12345000n)  -> "₹1.23 L"
 *   formatMoneyCompact(1234500n)   -> "₹12,345.00"
 *   formatMoneyCompact(null)       -> "—"
 */
export function formatMoneyCompact(minorUnits: bigint | number | string | null | undefined): string {
  const exact = formatMoney(minorUnits);
  if (exact === "—") return exact;
  // Re-derive the integer minor value the same way formatMoney did.
  let minor: bigint;
  if (typeof minorUnits === "bigint") minor = minorUnits;
  else if (typeof minorUnits === "number") minor = BigInt(Math.round(minorUnits));
  else {
    const t = String(minorUnits).trim();
    minor = /^[+-]?\d+$/.test(t) ? BigInt(t) : BigInt(Math.round(Number(t)));
  }
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const LAKH = 10_000_000n; // 1 lakh rupees in paise
  const CRORE = 1_000_000_000n; // 1 crore rupees in paise
  if (abs < LAKH) return exact;
  // Round half-up to 2 decimals of the unit: units of 1e5 paise (L) / 1e7 paise (Cr).
  const scaled = (unit: bigint) => (abs * 100n + unit / 2n) / unit; // hundredths of the unit
  const fmt = (hundredths: bigint, suffix: string) =>
    `${negative ? "-" : ""}₹${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")} ${suffix}`;
  const crore = scaled(CRORE);
  if (abs >= CRORE || scaled(LAKH) >= 10_000n) return fmt(crore, "Cr");
  return fmt(scaled(LAKH), "L");
}

/**
 * UX-006 type guard: safely convert a MINOR-units (paise) field to a plain
 * rupee `number` for arithmetic/comparisons or a form-input default — WITHOUT
 * silently turning missing data into a real-looking 0. Prefer this over a bare
 * `Number(x.someMinor) / 100`, which maps both `null` and unparseable input to
 * 0 (a value indistinguishable from an actual zero amount downstream). Returns
 * `null` for null/undefined/non-finite so callers can propagate "missing"
 * instead of computing on a fabricated zero.
 *
 *   minorToRupeesOrNull(12345)    -> 123.45
 *   minorToRupeesOrNull(null)     -> null
 *   minorToRupeesOrNull(undefined)-> null
 *   minorToRupeesOrNull("abc")    -> null
 */
export function minorToRupeesOrNull(minor: bigint | number | string | null | undefined): number | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const n = typeof minor === "bigint" ? Number(minor) : typeof minor === "number" ? minor : Number(minor);
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/**
 * Format a basis-points integer (1 bp = 0.01%) as a percent string for display,
 * stripping trailing zeros. Renders the *exact* bps/100 value — never rounds a
 * statutory rate/threshold before showing it.
 *
 *   formatBps(1200) -> "12%"
 *   formatBps(550)  -> "5.5%"
 *   formatBps(12)   -> "0.12%"
 */
export function formatBps(bps: number | string | null | undefined): string {
  if (bps === null || bps === undefined || bps === "") return "—";
  const n = typeof bps === "number" ? bps : Number(bps);
  if (!Number.isFinite(n)) return "—";
  const pct = n / 100;
  const fixed = pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${fixed}%`;
}

/**
 * Format an already-computed percentage (0-100 scale, e.g. 45.2 for 45.2%)
 * for display, fixed to `decimals` places.
 *
 * UX-006: null/undefined/non-finite is MISSING data — e.g. "no sanctioned
 * budget on record to compute utilisation against" — not a real 0%. It
 * renders "—" (same convention as formatBps/formatMoney/formatRupees),
 * never a fabricated "0.0%" that would be indistinguishable from a genuine
 * zero-utilisation budget.
 *
 *   formatPercent(45.2)  -> "45.2%"
 *   formatPercent(0)     -> "0.0%"
 *   formatPercent(null)  -> "—"
 *   formatPercent(NaN)   -> "—"
 */
export function formatPercent(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(decimals)}%`;
}

const PERIOD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a payroll period "YYYY-MM" for display: "2026-07" -> "Jul 2026"
 * (GAP-PAYROLL-ARREARS-06). null/empty -> "—"; an unparseable value is
 * passed through unchanged rather than hidden.
 */
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return "—";
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  return `${PERIOD_MONTHS[month - 1]} ${match[1]}`;
}

const PAY_PERIOD_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Format a backend pay-period string ("YYYY-MM") for display, e.g. in the
 * salary-slips list/detail pages (GAP-PAYROLL-SALARY-SLIPS-03,
 * GAP-PAYROLL-SALARY-SLIPS-DETAIL-06). Falls back to the raw string for
 * anything that isn't a recognisable "YYYY-MM" so an unexpected backend
 * value never disappears, it just isn't prettified.
 *
 *   formatPayPeriod("2026-08") -> "August 2026"
 *   formatPayPeriod(null)      -> "—"
 *   formatPayPeriod("garbage") -> "garbage"
 */
export function formatPayPeriod(payPeriod: string | null | undefined): string {
  if (!payPeriod) return "—";
  const match = /^(\d{4})-(\d{2})$/.exec(payPeriod.trim());
  if (!match) return payPeriod;
  const [, year, month] = match;
  const name = PAY_PERIOD_MONTH_NAMES[Number(month) - 1];
  return name ? `${name} ${year}` : payPeriod;
}

/**
 * GAP-FINANCE-PFMS-04: sum a list of minor-unit (paise) values defensively.
 * `BigInt("12.50")` / `BigInt("abc")` throw, and one bad row used to take the
 * whole server page into its error boundary. Valid entries are summed with
 * BigInt (no float math); anything that is not a plain integer string is
 * counted in `invalid` instead of throwing. null/undefined/"" count as zero
 * (an absent amount, not a corrupt one).
 *
 *   sumMinor(["100", "abc", "250"]) -> { total: 350n, invalid: 1 }
 *   sumMinor(["100", null, ""])     -> { total: 100n, invalid: 0 }
 */
export function sumMinor(values: readonly (string | number | bigint | null | undefined)[]): {
  total: bigint;
  invalid: number;
} {
  let total = 0n;
  let invalid = 0;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "bigint") {
      total += v;
      continue;
    }
    const text = typeof v === "number" ? (Number.isSafeInteger(v) ? String(v) : "") : v.trim();
    if (!/^-?\d+$/.test(text)) {
      invalid += 1;
      continue;
    }
    total += BigInt(text);
  }
  return { total, invalid };
}

/**
 * GAP-TENANT-ADMIN-AUDIT-01: count events whose timestamp falls within a
 * ROLLING 24-hour window ending at `now`, as opposed to the old
 * `timestamp.slice(0,10) === new Date().toISOString().slice(0,10)` check,
 * which compared UTC *calendar* dates — neither a rolling 24h window nor IST,
 * and which under-counted between 00:00–05:30 IST (when the UTC date is still
 * "yesterday"). An unparseable timestamp is skipped (never counted, never
 * throws). `now` is injectable for deterministic tests.
 *
 *   countLast24h([{timestamp:"2025-12-31T23:00:00Z"}], Date.parse("2026-01-01T01:00:00Z")) -> 1
 *   countLast24h([{timestamp:"2025-12-30T23:00:00Z"}], Date.parse("2026-01-01T01:00:00Z")) -> 0
 */
export function countLast24h(
  events: readonly { timestamp: string }[],
  now: number = Date.now(),
): number {
  const cutoff = now - 24 * 3600 * 1000;
  let count = 0;
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    if (!Number.isNaN(t) && t >= cutoff && t <= now) count += 1;
  }
  return count;
}
