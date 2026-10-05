/**
 * Low-level, offset-preserving scanners shared by field extraction and PII detection.
 * All scanners run over `normaliseForScan(text)` which is the same LENGTH as the input, so
 * offsets map 1:1 onto the original page text.
 */
import type { FieldKind } from "../types.js";
import { isValidAadhaar, verhoeffValidate } from "./verhoeff.js";

export interface RawMatch {
  kind: FieldKind;
  start: number;
  end: number;
  /** Normalised value (see ExtractedField.value). */
  value: string;
  /** 0..1 validation strength (checksum/format). */
  validation: number;
  /** Lower sorts first when resolving overlaps. */
  priority: number;
  /** True when an OCR confusion (O->0 ...) was corrected to make the match valid. */
  corrected?: boolean;
  /**
   * Labelled identifiers produced by a SPECIFIC label (voucher/bill, file, employee, UTR/invoice). Only these may
   * legitimately carry an Aadhaar-shaped number and therefore win over a checksum-failing Aadhaar shape. The
   * generic reference pattern (`Ref No`, `No.`, `Letter/Order/... No`) is NOT specific.
   */
  specific?: boolean;
}

export interface ScanOptions {
  /** Regex sources for employee numbers (case-insensitive). Default: EMP[-/]?\d{3,8}. */
  employeePatterns?: readonly string[];
  /** 2-digit years <= pivot map to 20yy, otherwise 19yy. Default 49 (so 49 -> 2049, 50 -> 1950). */
  twoDigitYearPivot?: number;
  /** Only emit Aadhaar candidates whose Verhoeff checksum is valid (default false: grouped candidates are kept at low validation). */
  strictAadhaar?: boolean;
  kinds?: readonly FieldKind[];
}

export const DEFAULT_EMPLOYEE_PATTERNS: readonly string[] = ["EMP[-/]?\\d{3,8}"];

// ---------------------------------------------------------------- normalisation

const DIGIT_BASES = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];

/** Map Indic / Arabic-Indic digits to ASCII, char-for-char (length preserved). */
export function normaliseIndicDigits(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let mapped = c;
    for (const base of DIGIT_BASES) {
      if (c >= base && c <= base + 9) {
        mapped = 48 + (c - base);
        break;
      }
    }
    out += mapped === c ? text[i] : String.fromCharCode(mapped);
  }
  return out;
}

/**
 * Safe OCR-confusion repair, only inside tokens that are overwhelmingly digits:
 * a 4+ char alnum token made of [0-9OoIl] with >= 2 real digits and >= half digits has O/o->0, I/l->1.
 * Length preserving.
 */
export function fixDigitConfusions(text: string): string {
  return text.replace(/(?<![A-Za-z0-9])[0-9OoIl]{4,}(?![A-Za-z0-9])/g, (tok) => {
    const real = (tok.match(/\d/g) ?? []).length;
    if (real < 2 || real < tok.length / 2) return tok;
    return tok.replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
  });
}

export function normaliseForScan(text: string): string {
  return fixDigitConfusions(normaliseIndicDigits(text));
}

// ---------------------------------------------------------------- helpers

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export type Scanner = (scan: string, orig: string, opts: ScanOptions) => RawMatch[];

function trimTrailingPunct(token: string): string {
  return token.replace(/[.,;:\-/]+$/, "");
}

// ---------------------------------------------------------------- scanners

// Aadhaar / VID scanning.
//
// Under-masking is the worse error under DPDP, so ANY Aadhaar-SHAPED number is reported even when its Verhoeff
// checksum fails (one OCR-misread digit is the common cause): 12 digits, first digit 2-9, contiguous or in 4-4-4
// groups separated by up to two spaces/hyphens or a line break (`[\s-]{0,2}` covers "  ", "\n", "\r\n", "-").
// Checksum-failing candidates keep a LOW validation (0.25 contiguous / 0.35 grouped) so reviewers can tell
// them apart; `strictAadhaar: true` is the opt-out and restores checksum-only behaviour.
// Known false-positive risk of the shape rule (accepted, documented): contiguous 12-digit ids/timestamps that
// start 2-9 (e.g. a yyyymmddhhmm stamp) and runs of three 4-digit numbers separated by wide gaps in tables are
// treated as possible Aadhaar. Phone numbers (10 digits, or 91+10 which the phone scanner claims first),
// amounts with thousand separators (commas) and decimals ("250000000000.50") are NOT matched.
// 16-digit VIDs (Virtual ID; 4-4-4-4 or contiguous; its last digit is a Verhoeff check digit) are reported as
// type "aadhaar" with a 16-digit `value` (previews show the last 4 only). 16-digit card numbers have the same
// shape and are masked as well (over-masking, never under-masking).
const SEP = String.raw`[\s-]{0,2}`;
const NOT_NUM_BEFORE = String.raw`(?<!\d|\d[.,])`;   // not glued to a longer number or a decimal/thousand tail
const NOT_NUM_AFTER = String.raw`(?!\d|[.,]\d)`;
// Groups may also be separated by a single "/" or "." (2345/6789/0123, 2345.6789.0123). Trade-off (accepted): a dotted
// 4.4.4 serial/version number that starts 2-9 and fails Verhoeff is flagged as a possible Aadhaar (over-masking);
// dates (15/03/2024, 2024/03/15), amounts (1,234.56) and dotted quads (192.168.001.001) are not 4-4-4 and unaffected,
// and year runs / timestamps stay excluded below.
const AADHAAR_RE = new RegExp(`${NOT_NUM_BEFORE}([2-9]\\d{3}(?:${SEP}\\d{4}${SEP}\\d{4}|[/.]\\d{4}[/.]\\d{4}))${NOT_NUM_AFTER}`, "g");
const VID_RE = new RegExp(`${NOT_NUM_BEFORE}(\\d{4}(?:${SEP}\\d{4}${SEP}\\d{4}${SEP}\\d{4}|[/.]\\d{4}[/.]\\d{4}[/.]\\d{4}))${NOT_NUM_AFTER}`, "g");
/** Three 19xx/20xx groups ("2024 2025 2026"): a run of years, not an Aadhaar. */
const isYearRun = (d: string): boolean => /^(?:19|20)\d{2}(?:19|20)\d{2}(?:19|20)\d{2}$/.test(d);
/** yyyymmddhhmm (19yy/20yy, valid month and day): a timestamp, not an Aadhaar. */
const isTimestamp = (d: string): boolean => /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}$/.test(d);

const scanAadhaar: Scanner = (scan, _orig, opts) => {
  const out: RawMatch[] = [];
  for (const m of scan.matchAll(VID_RE)) {
    const raw = m[1] ?? "";
    const start = m.index ?? 0;
    const digits = digitsOnly(raw);
    const valid = verhoeffValidate(digits);
    if (!valid && opts.strictAadhaar) continue;
    // a checksum-failing 16-digit shape that STARTS with a valid 12-digit Aadhaar is that Aadhaar followed by an
    // unrelated 4-digit number (e.g. a year on the next line): leave it to the 12-digit scanner
    if (!valid && isValidAadhaar(digits.slice(0, 12))) continue;
    // priority -1: a VID must win over the 12-digit candidate that overlaps its first three groups
    out.push({ kind: "aadhaar", start, end: start + raw.length, value: digits, validation: valid ? 1 : 0.35, priority: -1 });
  }
  for (const m of scan.matchAll(AADHAAR_RE)) {
    const raw = m[1] ?? "";
    const start = m.index ?? 0;
    const digits = digitsOnly(raw);
    const valid = isValidAadhaar(digits);
    if (!valid && opts.strictAadhaar) continue;
    // obvious non-Aadhaar runs are excluded from the checksum-FAILING shape only (a Verhoeff-valid number always counts)
    if (!valid && (isYearRun(digits) || isTimestamp(digits))) continue;
    const grouped = /[\s/.-]/.test(raw);
    out.push({
      kind: "aadhaar",
      start,
      end: start + raw.length,
      value: digits,
      validation: valid ? 1 : grouped ? 0.35 : 0.25,
      priority: valid ? 0 : 5.5,
    });
  }
  return out;
};

/** PAN 4th character = holder type (P person, C company, H HUF, A AOP, B BOI, G govt, J juridical, L local auth, F firm, T trust). */
export const PAN_ENTITY_CHARS = "PCHABGJLFT";
const PAN_RE = /(?<![A-Za-z0-9])([A-Z]{5})([0-9OIl]{4})([A-Z])(?![A-Za-z0-9])/g;
const scanPan: Scanner = (_scan, orig) => {
  const out: RawMatch[] = [];
  for (const m of orig.matchAll(PAN_RE)) {
    const letters = m[1] ?? "";
    const rawDigits = m[2] ?? "";
    const last = m[3] ?? "";
    if (!PAN_ENTITY_CHARS.includes(letters.charAt(3))) continue;
    const digits = rawDigits.replace(/O/g, "0").replace(/[Il]/g, "1");
    const corrected = digits !== rawDigits;
    const start = m.index ?? 0;
    out.push({
      kind: "pan",
      start,
      end: start + 10,
      value: `${letters}${digits}${last}`,
      validation: corrected ? 0.8 : 1,
      priority: 1,
      corrected,
    });
  }
  return out;
};

const IFSC_RE = /(?<![A-Za-z0-9])([A-Z]{4}0[A-Z0-9]{6})(?![A-Za-z0-9])/g;
const scanIfsc: Scanner = (_scan, orig) => {
  const out: RawMatch[] = [];
  for (const m of orig.matchAll(IFSC_RE)) {
    const start = m.index ?? 0;
    out.push({ kind: "ifsc", start, end: start + 11, value: m[1] ?? "", validation: 1, priority: 2 });
  }
  return out;
};

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const scanEmail: Scanner = (_scan, orig) => {
  const out: RawMatch[] = [];
  for (const m of orig.matchAll(EMAIL_RE)) {
    const start = m.index ?? 0;
    const raw = m[0].replace(/[.]+$/, "");
    out.push({ kind: "email", start, end: start + raw.length, value: raw.toLowerCase(), validation: 1, priority: 3 });
  }
  return out;
};

const PHONE_RE = /(?<![\d])(?:(?:\+\s?91|91|0)[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?![\d])/g;
const scanPhone: Scanner = (scan) => {
  const out: RawMatch[] = [];
  for (const m of scan.matchAll(PHONE_RE)) {
    const start = m.index ?? 0;
    const ten = digitsOnly(m[1] ?? "");
    if (ten.length !== 10) continue;
    out.push({ kind: "phone", start, end: start + m[0].length, value: `+91${ten}`, validation: 1, priority: 5 });
  }
  return out;
};

const ACCOUNT_RE =
  /(?:A\/c|A\/C|Acct?\.?|Account|खाता)(?:\s*(?:No|Number|Num|संख्या|सं)\.?)?[^\d\n]{0,12}?(\d(?:[\d ]{7,21})\d)(?!\d)/gi;
const scanAccount: Scanner = (scan) => {
  const out: RawMatch[] = [];
  for (const m of scan.matchAll(ACCOUNT_RE)) {
    const numRaw = m[1] ?? "";
    const digits = digitsOnly(numRaw);
    if (digits.length < 9 || digits.length > 18) continue;
    const start = (m.index ?? 0) + m[0].length - numRaw.length;
    out.push({ kind: "account_no", start, end: start + numRaw.length, value: digits, validation: 0.9, priority: 4 });
  }
  return out;
};

// ---- dates

const MONTHS_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10,
  november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10,
  nov: 11, dec: 12,
};
const MONTHS_HI: Record<string, number> = {
  "जनवरी": 1, "फरवरी": 2, "फ़रवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6, "जुलाई": 7, "अगस्त": 8,
  "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10, "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
};
const MONTH_ALT = [...Object.keys(MONTHS_EN), ...Object.keys(MONTHS_HI)].sort((a, b) => b.length - a.length).join("|");

function monthNumber(name: string): number | null {
  const lower = name.toLowerCase();
  return MONTHS_EN[lower] ?? MONTHS_HI[name] ?? null;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toIso(d: number, m: number, y: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function expandYear(ys: string, pivot: number): { year: number; twoDigit: boolean } {
  if (ys.length === 4) return { year: Number(ys), twoDigit: false };
  const yy = Number(ys);
  return { year: yy <= pivot ? 2000 + yy : 1900 + yy, twoDigit: true };
}

const DATE_NUM_RE = /(?<![\d])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d])/g;
const DATE_DMY_TEXT_RE = new RegExp(
  `(?<![\\d])(\\d{1,2})(?:st|nd|rd|th)?[\\s.,-]*(${MONTH_ALT})\\.?[\\s,.'-]*(\\d{4}|\\d{2})(?![\\d])`,
  "gi",
);
const DATE_MDY_TEXT_RE = new RegExp(
  `(?<![A-Za-z])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})(?![\\d])`,
  "gi",
);

const scanDate: Scanner = (scan, _orig, opts) => {
  const pivot = opts.twoDigitYearPivot ?? 49;
  const out: RawMatch[] = [];
  const push = (m: RegExpMatchArray, d: number, mo: number, ys: string, textual: boolean): void => {
    const { year, twoDigit } = expandYear(ys, pivot);
    const iso = toIso(d, mo, year);
    if (!iso) return;
    const start = m.index ?? 0;
    out.push({
      kind: "date", start, end: start + m[0].length, value: iso,
      validation: twoDigit ? 0.8 : textual ? 1 : 0.95, priority: 11,
    });
  };
  for (const m of scan.matchAll(DATE_NUM_RE)) push(m, Number(m[1]), Number(m[2]), m[3] ?? "", false);
  for (const m of scan.matchAll(DATE_DMY_TEXT_RE)) {
    const mo = monthNumber(m[2] ?? "");
    if (mo) push(m, Number(m[1]), mo, m[3] ?? "", true);
  }
  for (const m of scan.matchAll(DATE_MDY_TEXT_RE)) {
    const mo = monthNumber(m[1] ?? "");
    if (mo) push(m, Number(m[2]), mo, m[3] ?? "", true);
  }
  return out;
};

// ---- amounts (paise as digit string, never float)

const NUM = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?`;
const AMOUNT_RE = new RegExp(
  String.raw`(?:(?<![A-Za-z])(?:Rs\.?|INR|₹|रु\.?|Rupees)\s*(${NUM})(?:\s*/-)?|(?<![\d/.,-])(${NUM})\s*/-)`,
  "gi",
);

/** "1,23,456.78" -> "12345678" (paise). Never goes through floating point. */
export function rupeesToPaise(num: string): string {
  const cleaned = num.replace(/,/g, "");
  const [ints = "0", frac = ""] = cleaned.split(".");
  const paise = `${ints}${(frac + "00").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  return paise === "" ? "0" : paise;
}

const INDIAN_GROUPING = /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/;
const WESTERN_GROUPING = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const scanAmount: Scanner = (scan) => {
  const out: RawMatch[] = [];
  for (const m of scan.matchAll(AMOUNT_RE)) {
    const num = m[1] ?? m[2] ?? "";
    if (num === "") continue;
    const start = m.index ?? 0;
    let validation = m[1] !== undefined ? 1 : 0.9;
    if (num.includes(",")) {
      if (INDIAN_GROUPING.test(num)) validation *= 1;
      else if (WESTERN_GROUPING.test(num)) validation *= 0.85;
      else validation *= 0.6;
    }
    out.push({ kind: "amount_inr", start, end: start + m[0].length, value: rupeesToPaise(num), validation, priority: 10 });
  }
  return out;
};

// ---- reference-like identifiers

const TOKEN = String.raw`([A-Za-z0-9][A-Za-z0-9()/.\-]*)`;
const FILE_RE = new RegExp(String.raw`(?:(?<![A-Za-z])F\.?\s?No\.?|File\s*No\.?|फ़?ाइल\s*(?:संख्या|सं\.?)|फा\.?\s*सं\.?)\s*[:\-]?\s*${TOKEN}`, "gi");
const REF_RE = new RegExp(
  String.raw`(?:Ref(?:erence)?\.?\s*(?:No\.?)?|(?:Letter|Order|Our|Your|Memo|Dak|Case)\s*\.?\s*No\.?|(?<![A-Za-z.])No\.)\s*[:\-]?\s*${TOKEN}`,
  "gi",
);
const VOUCHER_RE = new RegExp(String.raw`(?:Voucher|Vr\.?|Bill|वाउचर)\s*(?:No\.?|Number|#|संख्या)\s*[:\-]?\s*${TOKEN}`, "gi");
const EMP_LABEL_RE = new RegExp(
  String.raw`(?:Emp\.?|Employee)\s*(?:No\.?|ID|Id|Code|Number|Num)\.?\s*[:\-#]?\s*${TOKEN}`,
  "gi",
);

function tokenMatches(
  scan: string,
  re: RegExp,
  kind: FieldKind,
  priority: number,
  accept: (tok: string) => boolean,
  upper: boolean,
  specific = true,
): RawMatch[] {
  const out: RawMatch[] = [];
  const withIdx = new RegExp(re.source, re.flags.includes("d") ? re.flags : `${re.flags}d`);
  for (const m of scan.matchAll(withIdx)) {
    const span = m.indices?.[1];
    if (!span) continue;
    const tok = trimTrailingPunct(m[1] ?? "");
    if (!accept(tok)) continue;
    out.push({
      kind, start: span[0], end: span[0] + tok.length, value: upper ? tok.toUpperCase() : tok,
      validation: 0.9, priority, ...(specific ? { specific: true } : {}),
    });
  }
  return out;
}

// UTR (bank transfer reference) and invoice numbers -> reference_no (additive: no new FieldKind)
const UTR_INVOICE_RE = new RegExp(
  String.raw`(?:(?<![A-Za-z])UTR|(?<![A-Za-z])Invoice\s*(?:No\.?|Number|#))\s*(?:No\.?|Number|#)?\s*[:\-]?\s*${TOKEN}`,
  "gi",
);

const hasDigit = (t: string): boolean => /\d/.test(t);
const scanFileNo: Scanner = (scan) => tokenMatches(scan, FILE_RE, "file_no", 7, (t) => hasDigit(t) && t.length >= 2, false);
const scanRef: Scanner = (scan) =>
  tokenMatches(scan, REF_RE, "reference_no", 8, (t) => hasDigit(t) && /[/-]/.test(t) && t.length >= 3, false, false);
const scanUtrInvoice: Scanner = (scan) => tokenMatches(scan, UTR_INVOICE_RE, "reference_no", 8, (t) => hasDigit(t) && t.length >= 6, false);
const scanVoucher: Scanner = (scan) => tokenMatches(scan, VOUCHER_RE, "voucher_no", 6, (t) => hasDigit(t), true);

const scanEmployee: Scanner = (scan, _orig, opts) => {
  const out = tokenMatches(scan, EMP_LABEL_RE, "employee_no", 9, (t) => hasDigit(t) && t.length >= 3, true);
  for (const src of opts.employeePatterns ?? DEFAULT_EMPLOYEE_PATTERNS) {
    const re = new RegExp(`(?<![A-Za-z0-9])(?:${src})(?![A-Za-z0-9])`, "gi");
    for (const m of scan.matchAll(re)) {
      const start = m.index ?? 0;
      out.push({ kind: "employee_no", start, end: start + m[0].length, value: m[0].toUpperCase(), validation: 0.95, priority: 9 });
    }
  }
  return out;
};

/** An Aadhaar-ish keyword within the ~25 characters before a number (Latin and Devanagari, any case). */
const AADHAAR_KEYWORD = /aadh?a+r|\buid(?:ai)?\b|\bvid\b|आधार|unique\s*id/i;
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/;

/**
 * Aadhaar keyword guard window: up to 60 characters BEFORE the number, restricted to the current line plus the
 * previous line and never crossing a blank line (paragraph break); up to 25 characters AFTER, restricted to the
 * same paragraph. A keyword outside this window does not suppress the labelled-wins rule.
 */
function aadhaarKeywordNear(scan: string, start: number, end: number): boolean {
  let before = scan.slice(Math.max(0, start - 60), start);
  const para = before.split(PARAGRAPH_BREAK);
  before = (para[para.length - 1] ?? "").split(/\r?\n/).slice(-2).join("\n");
  const after = (scan.slice(end, end + 25).split(PARAGRAPH_BREAK)[0] ?? "");
  return AADHAAR_KEYWORD.test(before) || AADHAAR_KEYWORD.test(after);
}

/**
 * True when `s` (a field value or raw text) contains an Aadhaar-shaped digit run once separators (space - / .) are
 * removed: 12 digits starting 2-9 (excluding obvious timestamps / year runs unless the checksum is valid) or a
 * 16-digit VID. Used by extractFields as defence in depth for non-Aadhaar field kinds.
 */
export function aadhaarShapedDigits(s: string): string | null {
  const collapsed = normaliseIndicDigits(s).replace(/[\s\-/.]/g, "");
  for (const m of collapsed.matchAll(/(?<!\d)(\d{12,16})(?!\d)/g)) {
    const d = m[1] ?? "";
    if (d.length === 16) return d;
    if (d.length === 12 && /^[2-9]/.test(d) && (isValidAadhaar(d) || !(isYearRun(d) || isTimestamp(d)))) return d;
  }
  return null;
}

const SCANNERS: readonly { kinds: readonly FieldKind[]; run: Scanner }[] = [
  { kinds: ["aadhaar"], run: scanAadhaar },
  { kinds: ["pan"], run: scanPan },
  { kinds: ["ifsc"], run: scanIfsc },
  { kinds: ["email"], run: scanEmail },
  { kinds: ["account_no"], run: scanAccount },
  { kinds: ["phone"], run: scanPhone },
  { kinds: ["voucher_no"], run: scanVoucher },
  { kinds: ["file_no"], run: scanFileNo },
  { kinds: ["reference_no"], run: scanRef },
  { kinds: ["reference_no"], run: scanUtrInvoice },
  { kinds: ["employee_no"], run: scanEmployee },
  { kinds: ["amount_inr"], run: scanAmount },
  { kinds: ["date"], run: scanDate },
];

/** Run all (or selected) scanners and resolve overlaps by priority (then length, then position). */
export function scanAll(text: string, opts: ScanOptions = {}): RawMatch[] {
  const scan = normaliseForScan(text);
  const wanted = opts.kinds ? new Set<FieldKind>(opts.kinds) : null;
  const all: RawMatch[] = [];
  for (const s of SCANNERS) {
    if (wanted && !s.kinds.some((k) => wanted.has(k))) continue;
    all.push(...s.run(scan, text, opts));
  }
  // A checksum-FAILING Aadhaar shape never erases a labelled identifier ("Voucher No: 345678901234",
  // "File No ...", "Emp ID ...", "UTR ..."): the labelled field is kept for extraction. PII detection scans only the
  // PII kinds (no labelled kinds), so detectPii/maskText/AI redaction still mask the very same digits.
  // Only SPECIFIC labels count (see RawMatch.specific); the generic reference pattern never erases an Aadhaar shape,
  // and neither does any label when an Aadhaar keyword sits just before the number ("Aadhaar No. 2345-6789-0123").
  const labelled = all.filter((m) => m.specific === true);
  // A 16-digit number right after an account label is an account number (bank_account policy), not a VID.
  const accounts = all.filter((m) => m.kind === "account_no");
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i] as RawMatch;
    if (m.kind !== "aadhaar") continue;
    const overlaps = (o: RawMatch): boolean => m.start < o.end && o.start < m.end;
    if (m.validation < 1 && labelled.some(overlaps) && !aadhaarKeywordNear(scan, m.start, m.end)) all.splice(i, 1);
    else if (m.value.length === 16 && accounts.some(overlaps)) all.splice(i, 1);
  }
  all.sort((a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const accepted: RawMatch[] = [];
  for (const m of all) {
    if (wanted && !wanted.has(m.kind)) continue;
    if (accepted.some((a) => m.start < a.end && a.start < m.end)) continue;
    accepted.push(m);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------- previews (never raw)

const last = (s: string, n: number): string => s.slice(Math.max(0, s.length - n));

export function previewFor(kind: "aadhaar" | "pan" | "account_no" | "phone" | "email", value: string): string {
  switch (kind) {
    case "aadhaar": return value.length === 16 ? `XXXX XXXX XXXX ${last(value, 4)}` : `XXXX XXXX ${last(value, 4)}`; // 16 digits = VID
    case "pan": return `XXXXXX${last(value, 4)}`;
    case "account_no": return `${"X".repeat(Math.max(0, value.length - 4))}${last(value, 4)}`;
    case "phone": return `XXXXXX${last(value, 4)}`;
    case "email": {
      const at = value.indexOf("@");
      return at >= 0 ? `***${value.slice(at)}` : "***";
    }
  }
}
