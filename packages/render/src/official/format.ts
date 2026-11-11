/**
 * Formatting for issued documents: Indian digit grouping, IST dates, masked PAN.
 * Pure and deterministic (no locale-dependent Intl month names: en-IN prints "Sept", and an
 * issued document must read the same on every server).
 */

export type DocLang = "en" | "hi";

/** Exact bigint paise from a DB/wire value (bigint, safe integer, or digit string). */
export function toMinor(v: bigint | number | string | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new RangeError(`toMinor: ${v} is not a whole number of paise`);
    return BigInt(v);
  }
  const s = v.trim();
  if (!/^-?\d+$/.test(s)) throw new RangeError(`toMinor: "${s}" is not a whole number of paise`);
  return BigInt(s);
}

/** "12345678" -> "1,23,45,678" (Indian grouping: last three digits, then pairs). */
export function groupIndianDigits(digits: string): string {
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
}

/** A whole number with Indian grouping: 1234567 -> "12,34,567". */
export function formatIndianInteger(n: bigint | number): string {
  const b = typeof n === "bigint" ? n : BigInt(Math.trunc(n));
  const neg = b < 0n;
  const s = groupIndianDigits((neg ? -b : b).toString());
  return neg ? `-${s}` : s;
}

/** Paise -> "1,23,456.78" (no symbol). */
export function formatMinorIndian(minor: bigint | number | string): string {
  const m = toMinor(minor);
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const s = `${groupIndianDigits((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Paise -> "₹ 1,23,456.78". */
export function formatInr(minor: bigint | number | string): string {
  const s = formatMinorIndian(minor);
  return s.startsWith("-") ? `-₹ ${s.slice(1)}` : `₹ ${s}`;
}

export const IST_TIME_ZONE = "Asia/Kolkata";
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्तूबर", "नवंबर", "दिसंबर"] as const;

interface IstParts { year: number; month: number; day: number; hour: number; minute: number }

const istFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: IST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function istParts(d: Date): IstParts {
  const p: Record<string, string> = {};
  for (const part of istFormatter.formatToParts(d)) p[part.type] = part.value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

function parseDateLike(v: Date | string | null | undefined): { date: Date; dateOnly: IstParts | null } | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (m) {
      // A calendar date (DB `date` column) has no time zone: print it as written.
      const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 0, minute: 0 };
      return { date: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)), dateOnly: parts };
    }
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : { date: d, dateOnly: null };
}

function monthName(month: number, lang: DocLang): string {
  return (lang === "hi" ? HI_MONTHS : EN_MONTHS)[month - 1] ?? String(month);
}

/** "04 Nov 2026" (IST calendar date); "04 नवंबर 2026" in Hindi; "—" when absent or invalid. */
export function formatDateIst(v: Date | string | null | undefined, lang: DocLang = "en"): string {
  const parsed = parseDateLike(v);
  if (!parsed) return "—";
  const p = parsed.dateOnly ?? istParts(parsed.date);
  return `${String(p.day).padStart(2, "0")} ${monthName(p.month, lang)} ${p.year}`;
}

/** "19 Nov 2026, 10:18 PM IST" (a timestamp shown in Indian Standard Time). */
export function formatDateTimeIst(v: Date | string | null | undefined, lang: DocLang = "en"): string {
  const parsed = parseDateLike(v);
  if (!parsed) return "—";
  if (parsed.dateOnly) return formatDateIst(v, lang);
  const p = istParts(parsed.date);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  return `${formatDateIst(parsed.date, lang)}, ${String(h12).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} ${ampm} IST`;
}

/** "2026-08" -> "August 2026" / "अगस्त 2026" (pay period of a salary slip). */
export function formatMonthYear(ym: string, lang: DocLang = "en"): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return ym;
  const month = Number(m[2]);
  const EN_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = lang === "hi" ? HI_MONTHS[month - 1] : EN_FULL[month - 1];
  return name ? `${name} ${m[1]}` : ym;
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * PAN as printed on a payslip or 12BA: the letters are masked and the four digits shown,
 * "ABCDE1234F" -> "XXXXX1234X". A value that is not a well-formed PAN is masked except its
 * last four characters; an absent PAN prints as "" so the caller can say "not recorded".
 */
export function maskPanForPrint(pan: string | null | undefined): string {
  const p = (pan ?? "").trim().toUpperCase();
  if (!p) return "";
  if (PAN_RE.test(p)) return `XXXXX${p.slice(5, 9)}X`;
  return p.length <= 4 ? "X".repeat(p.length) : `${"X".repeat(p.length - 4)}${p.slice(-4)}`;
}

/** Bank account as printed: only the last four digits ("XXXXXX4321"). */
export function maskAccountForPrint(acct: string | null | undefined): string {
  const a = (acct ?? "").replace(/\s+/g, "");
  if (!a) return "";
  return a.length <= 4 ? a : `${"X".repeat(Math.min(a.length - 4, 8))}${a.slice(-4)}`;
}

/** Indian financial year label for a date: 2026-11-04 -> "2026-27". */
export function financialYearOf(v: Date | string): string {
  const parsed = parseDateLike(v);
  if (!parsed) return "";
  const p = parsed.dateOnly ?? istParts(parsed.date);
  const start = p.month >= 4 ? p.year : p.year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
