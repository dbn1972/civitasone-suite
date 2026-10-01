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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

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
