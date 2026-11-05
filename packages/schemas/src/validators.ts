/**
 * Shared input validators (UAT T-EDGE bundle 21, TE-01 / TE-03 / TE-05 / TE-06 / TE-07).
 *
 * Every helper here is a pure function or a zod field, so a service can apply it
 * SYNCHRONOUSLY at the route boundary, before it answers 202 and queues a command.
 * A value that fails one of these checks used to be 202-accepted and then dropped by
 * the worker (or 500 on the synchronous HRMS routes) -- see the T-EDGE summary.
 *
 * Each failure carries a stable FIELD CODE in the zod issue params (`params.code`).
 * The shared error envelope (http.ts) copies it into `fieldErrors[].code`, and the web
 * error layer maps the code to plain-language en/hi copy. The English `message` is
 * developer text and a fallback only.
 */
import { z } from "zod";

/** Stable field-level error codes (web copy: apps/web/src/lib/fieldErrorCodes.ts). */
export const FIELD_CODES = {
  DATE_INVALID: "DATE_INVALID",
  DATE_TOO_EARLY: "DATE_TOO_EARLY",
  DATE_TOO_LATE: "DATE_TOO_LATE",
  DATE_IN_FUTURE: "DATE_IN_FUTURE",
  DATE_IN_PAST: "DATE_IN_PAST",
  DATE_ORDER: "DATE_ORDER",
  AGE_OUT_OF_RANGE: "AGE_OUT_OF_RANGE",
  TEXT_BLANK: "TEXT_BLANK",
  AADHAAR_INVALID: "AADHAAR_INVALID",
  IFSC_INVALID: "IFSC_INVALID",
  UAN_INVALID: "UAN_INVALID",
  GSTIN_INVALID: "GSTIN_INVALID",
  MOBILE_INVALID: "MOBILE_INVALID",
  PAN_INVALID: "PAN_INVALID",
  AMOUNT_TOO_LARGE: "AMOUNT_TOO_LARGE",
  FY_INVALID: "FY_INVALID",
  ACCEPTED_EXCEEDS_RECEIVED: "ACCEPTED_EXCEEDS_RECEIVED",
} as const;
export type FieldCode = (typeof FIELD_CODES)[keyof typeof FIELD_CODES];

/** Add a zod issue carrying a field code (picked up by the shared error envelope). */
export function fieldIssue(ctx: z.RefinementCtx, code: FieldCode, message: string, path?: (string | number)[]): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, message, params: { code }, ...(path ? { path } : {}) });
}

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a REAL calendar date written YYYY-MM-DD: 2025-02-29 (not a leap
 * year), 2026-04-31 and 2026-02-30 are false; so are "yesterday", "31/04/2027" and
 * "2026-1-5". A regex alone accepts the impossible dates, which Postgres then
 * refuses (HTTP 500 / a poison message) or, for free text, reads as a date literal.
 */
export function isRealIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today in India (IST, UTC+05:30) as YYYY-MM-DD. `now` is injectable for tests. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Add whole years to a real ISO date; 29 Feb rolls to 28 Feb in a non-leap year. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const ty = y + years;
  const last = new Date(Date.UTC(ty, m, 0)).getUTCDate();
  return `${String(ty).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Add whole days to a real ISO date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole years between two ISO dates (age on `on` for a birth date `from`). */
export function yearsBetween(from: string, on: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = on.split("-").map(Number) as [number, number, number];
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}

/** Indian financial year (April-March) that contains `iso`: start/end dates and the "YYYY-YY" label. */
export function financialYearOf(iso: string): { start: string; end: string; label: string } {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const startYear = m >= 4 ? y : y - 1;
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
  };
}

/** A date window, both ends inclusive, as YYYY-MM-DD strings. */
export type DateWindow = { min?: string; max?: string };

/** Result of a range check: null when inside, otherwise the field code + English text. */
export type DateRangeFailure = { code: FieldCode; message: string } | null;

/** Check a real ISO date against a window. Call `isRealIsoDate` first. */
export function checkDateWindow(iso: string, window: DateWindow, label = "date"): DateRangeFailure {
  if (window.min && iso < window.min) return { code: FIELD_CODES.DATE_TOO_EARLY, message: `${label} must be on or after ${window.min}` };
  if (window.max && iso > window.max) return { code: FIELD_CODES.DATE_TOO_LATE, message: `${label} must be on or before ${window.max}` };
  return null;
}

/**
 * Plausible-range windows per use (TE-07). Each takes "today" (IST) so the window
 * moves with the calendar and tests can pin it.
 */
export const DATE_WINDOWS = {
  /** Date of joining: not before 1950, not more than a year ahead. */
  dateOfJoining: (today: string): DateWindow => ({ min: "1950-01-01", max: addYears(today, 1) }),
  /** Leave: not more than a year back, not more than two years ahead. */
  leave: (today: string): DateWindow => ({ min: addYears(today, -1), max: addYears(today, 2) }),
  /**
   * A transaction date (journal posting, salary revision): from the start of the
   * financial year `pastFys` before today to the end of the one `futureFys` after.
   */
  transaction: (today: string, pastFys = 1, futureFys = 1): DateWindow => {
    const fy = financialYearOf(today);
    return { min: addYears(fy.start, -pastFys), max: addYears(fy.end, futureFys) };
  },
  /** Something that must happen from today on (indent required-by, PO delivery), at most `years` ahead. */
  upcoming: (today: string, years = 3): DateWindow => ({ min: today, max: addYears(today, years) }),
  /** Something that already happened (goods received, notice served), at most `years` back, never in the future. */
  happened: (today: string, years = 1): DateWindow => ({ min: addYears(today, -years), max: today }),
} as const;

/** Read a positive whole number of years from the environment, or the default. */
export function yearsFromEnv(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 50 ? n : fallback;
}

/**
 * Zod field: a real calendar date YYYY-MM-DD (TE-01). Optional `window` is a
 * function so the range is computed per request, not at module load.
 */
export function zIsoDate(opts: { window?: () => DateWindow; label?: string } = {}) {
  const label = opts.label ?? "date";
  return z.string().trim().superRefine((v, ctx) => {
    if (!isRealIsoDate(v)) {
      fieldIssue(ctx, FIELD_CODES.DATE_INVALID, `${label} must be a real calendar date written YYYY-MM-DD`);
      return;
    }
    if (opts.window) {
      const fail = checkDateWindow(v, opts.window(), label);
      if (fail) fieldIssue(ctx, fail.code, fail.message);
    }
  });
}

/**
 * Age check for a date of birth against the date of joining (TE-07): the employee
 * must be `minAge`..`maxAge` (inclusive) on the joining date. Null when fine. Defaults 18..70,
 * overridable with MIN_AGE_AT_JOINING / MAX_AGE_AT_JOINING (e.g. 14 for NAPS apprentices, higher for
 * re-employed staff).
 */
export function ageAtJoiningBounds(env: NodeJS.ProcessEnv = process.env): { min: number; max: number } {
  const pick = (raw: string | undefined, d: number) => (raw && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : d);
  return { min: pick(env.MIN_AGE_AT_JOINING, 18), max: pick(env.MAX_AGE_AT_JOINING, 70) };
}
export function checkAgeAtJoining(dateOfBirth: string, dateOfJoining: string, minAge = ageAtJoiningBounds().min, maxAge = ageAtJoiningBounds().max): DateRangeFailure {
  const age = yearsBetween(dateOfBirth, dateOfJoining);
  if (age < minAge || age > maxAge) {
    return { code: FIELD_CODES.AGE_OUT_OF_RANGE, message: `age on the date of joining must be ${minAge} to ${maxAge} years (it is ${age})` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Zod field: trimmed, and not blank after trimming (TE-06). The stored value is the
 * trimmed one, so a duplicate check on the stored value cannot be bypassed with
 * leading or trailing spaces.
 */
export function zTrimmedText(max: number, opts: { min?: number; label?: string } = {}) {
  const min = opts.min ?? 1;
  const label = opts.label ?? "this field";
  return z.string().max(max * 4).transform((v) => v.trim()).superRefine((v, ctx) => {
    // Invisible format characters (zero-width space, BOM, ...) are not content; ZWJ/ZWNJ stay
    // legal inside Devanagari words, they only do not count towards "not blank".
    if (v.replace(/\p{Cf}/gu, "").trim().length === 0) {
      fieldIssue(ctx, FIELD_CODES.TEXT_BLANK, `${label} must not be blank`);
      return;
    }
    if (v.length < min) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, inclusive: true, type: "string", message: `${label} must be at least ${min} characters` });
    if (v.length > max) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: "string", message: `${label} must be at most ${max} characters` });
  });
}

/** Zod field: a code (employee no, account code, notice no): trimmed, not blank, no inner line breaks. */
export function zTrimmedCode(max: number, label = "code") {
  return zTrimmedText(max, { label }).superRefine((v, ctx) => {
    if (/[\r\n\t]/.test(v)) fieldIssue(ctx, FIELD_CODES.TEXT_BLANK, `${label} must be on one line`);
  });
}

// ---------------------------------------------------------------------------
// Indian statutory identifiers (TE-05)
// ---------------------------------------------------------------------------

// Verhoeff (dihedral group D5) tables, as used by UIDAI for the Aadhaar check digit.
const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV: readonly number[] = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** True when the digit string (check digit last) passes the Verhoeff check. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![Number(rev[i])]!]!;
  return c === 0;
}

/** The Verhoeff check digit for a digit string (without its check digit). */
export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const rev = digits.split("").reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[(i + 1) % 8]![Number(rev[i])]!]!;
  return VERHOEFF_INV[c]!;
}

/** Aadhaar digits with spaces / hyphens removed ("2341 2341 2346" -> "234123412346"). */
export function normaliseAadhaar(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** A full Aadhaar number: 12 digits, first digit 2-9 (never 0 or 1), Verhoeff check digit valid. */
export function isValidAadhaar(value: string): boolean {
  const d = normaliseAadhaar(value);
  return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d);
}

/** UIDAI-style masked form kept at rest: only the last four digits ("XXXX-XXXX-2346"). */
export function maskAadhaar(value: string): string {
  return `XXXX-XXXX-${normaliseAadhaar(value).slice(-4)}`;
}

/** A value already in the masked form ("XXXX-XXXX-2346" / "XXXX XXXX 2346" / "XXXXXXXX2346"). */
export function isMaskedAadhaar(value: string): boolean {
  return /^X{4}[\s-]?X{4}[\s-]?\d{4}$/i.test(value.trim());
}

/** IFSC: 4 bank letters, a literal 0, 6 branch characters. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function isValidIfsc(value: string): boolean {
  return IFSC_RE.test(value.trim().toUpperCase());
}

/** EPFO Universal Account Number: exactly 12 digits. */
export const UAN_RE = /^\d{12}$/;
export function isValidUan(value: string): boolean {
  return UAN_RE.test(value.trim());
}

/** PAN: 5 letters, 4 digits, 1 letter (the same pattern the services already enforce). */
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export function isValidPan(value: string): boolean {
  return PAN_RE.test(value.trim());
}

/** Indian mobile: 10 digits starting 6-9, optionally written with +91 (or 91 / 0) in front. */
export const MOBILE_RE = /^(?:\+?91|0091|0)?([6-9]\d{9})$/;
/** Spaces, hyphens, dots and parentheses people type inside a number are not part of it. */
const MOBILE_SEPARATORS_RE = /[\s().-]/g;
export function isValidIndianMobile(value: string): boolean {
  return MOBILE_RE.test(value.trim().replace(MOBILE_SEPARATORS_RE, ""));
}
/** The bare 10-digit number of a valid Indian mobile, or null. */
export function normaliseIndianMobile(value: string): string | null {
  const m = MOBILE_RE.exec(value.trim().replace(MOBILE_SEPARATORS_RE, ""));
  return m ? (m[1] as string) : null;
}

const GSTIN_CODE_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** state (2 digits) + PAN (5A 4d 1A) + entity (1-9 / A-Z) + "Z" + check character. */
export const GSTIN_STRUCTURE_RE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])[1-9A-Z]Z[0-9A-Z]$/;

/** GSTN mod-36 check character for the first 14 characters (same algorithm as apps/web/src/lib/gstin.ts). */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const code = GSTIN_CODE_CHARS.indexOf(first14[i] as string);
    if (code < 0) return null;
    const product = code * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CODE_CHARS[(36 - (total % 36)) % 36] ?? null;
}

/** GST state codes 01-38 (states and UTs) plus 97 (Other Territory). */
export function isValidGstStateCode(code: string): boolean {
  const n = Number(code);
  return /^\d{2}$/.test(code) && ((n >= 1 && n <= 38) || n === 97);
}

/** GSTIN: structure, a valid state code, the embedded PAN, and the mod-36 checksum. */
export function isValidGstin(value: string): boolean {
  const g = value.trim().toUpperCase();
  const m = GSTIN_STRUCTURE_RE.exec(g);
  if (!m) return false;
  if (!isValidGstStateCode(m[1] as string)) return false;
  if (!isValidPan(m[2] as string)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** Zod fields for the identifiers above (trimmed; IFSC / GSTIN upper-cased). */
export const zIfsc = z.string().trim().transform((v) => v.toUpperCase()).superRefine((v, ctx) => {
  if (!IFSC_RE.test(v)) fieldIssue(ctx, FIELD_CODES.IFSC_INVALID, "IFSC must be 4 letters, a zero, then 6 letters or digits (e.g. SBIN0001234)");
});
export const zUan = z.string().trim().superRefine((v, ctx) => {
  if (!UAN_RE.test(v)) fieldIssue(ctx, FIELD_CODES.UAN_INVALID, "UAN must be exactly 12 digits");
});
export const zGstin = z.string().trim().transform((v) => v.toUpperCase()).superRefine((v, ctx) => {
  if (!isValidGstin(v)) fieldIssue(ctx, FIELD_CODES.GSTIN_INVALID, "GSTIN is not valid (state code, PAN or check character)");
});
/** Valid input in any common spelling; the OUTPUT is the bare 10-digit number so one number is stored one way. */
export const zIndianMobile = z.string().trim().superRefine((v, ctx) => {
  if (!isValidIndianMobile(v)) fieldIssue(ctx, FIELD_CODES.MOBILE_INVALID, "mobile must be a 10-digit Indian number starting 6-9, optionally with +91");
}).transform((v) => normaliseIndianMobile(v) ?? v);
export const zPan = z.string().trim().superRefine((v, ctx) => {
  if (!PAN_RE.test(v)) fieldIssue(ctx, FIELD_CODES.PAN_INVALID, "must be a valid PAN (AAAAA9999A)");
});
/**
 * Aadhaar input: a full 12-digit number (Verhoeff-checked) or the masked form.
 * The OUTPUT is always the masked form, so the full number is never stored
 * (UIDAI: only the last four digits outside an Aadhaar Data Vault).
 */
export const zAadhaarMasked = z.string().trim().superRefine((v, ctx) => {
  if (isMaskedAadhaar(v)) return;
  if (!isValidAadhaar(v)) fieldIssue(ctx, FIELD_CODES.AADHAAR_INVALID, "Aadhaar must be the full 12-digit number (first digit 2-9, valid check digit)");
}).transform((v) => (isMaskedAadhaar(v) ? maskAadhaar(v.replace(/X/gi, "0")) : maskAadhaar(v)));

// ---------------------------------------------------------------------------
// Money and financial year
// ---------------------------------------------------------------------------

/** Postgres bigint ceiling. */
export const BIGINT_MAX = 9_223_372_036_854_775_807n;
/**
 * Sane ceiling for one money amount in paise. Default 10^15 paise (Rs 10 lakh crore);
 * set MONEY_MAX_MINOR to change it (never above the Postgres bigint ceiling).
 */
export function moneyMaxMinor(env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = env.MONEY_MAX_MINOR?.trim();
  if (raw && /^\d+$/.test(raw)) {
    const v = BigInt(raw);
    if (v > 0n && v <= BIGINT_MAX) return v;
  }
  return 1_000_000_000_000_000n;
}

/** Null when `minor` is within 0..moneyMaxMinor(), otherwise the failure. */
export function checkMoneyBound(minor: bigint): DateRangeFailure {
  const max = moneyMaxMinor();
  if (minor > max) return { code: FIELD_CODES.AMOUNT_TOO_LARGE, message: `amount must be at most ${max} paise` };
  return null;
}

/** Zod refinement for a JSON-number amount in paise: a safe integer within the sane maximum. */
export function boundedMinorNumber(v: number, ctx: z.RefinementCtx): void {
  if (!Number.isSafeInteger(v) || checkMoneyBound(BigInt(v))) {
    fieldIssue(ctx, FIELD_CODES.AMOUNT_TOO_LARGE, `amount must be at most ${moneyMaxMinor()} paise`);
  }
}

/** Zod refinement for a bigint amount in paise within the sane maximum. */
export function boundedMinorBigint(v: bigint, ctx: z.RefinementCtx): void {
  const fail = checkMoneyBound(v);
  if (fail) fieldIssue(ctx, fail.code, fail.message);
}

/** Financial-year label "YYYY-YY" whose second part is the next year (2026-27 yes; 2031-99, 2026-26 no). */
export function isValidFyLabel(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return false;
  const start = Number(m[1]);
  return start >= 1950 && start <= 2099 && (start + 1) % 100 === Number(m[2]);
}

export const zFyLabel = z.string().trim().superRefine((v, ctx) => {
  if (!isValidFyLabel(v)) fieldIssue(ctx, FIELD_CODES.FY_INVALID, "financial year must be YYYY-YY with consecutive years, e.g. 2026-27");
});
