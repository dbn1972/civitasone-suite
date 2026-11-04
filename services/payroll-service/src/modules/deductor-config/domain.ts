/**
 * UAT P3 b19 D-15: the TDS deductor (the employer that deducts salary TDS and
 * files Form 24Q / 26Q, signs Form 16 and Form 12BA) -- its name, TAN and PAN.
 *
 * These used to fall back to placeholder text ("<TAN — configure EMPLOYER_TAN>")
 * which then went out on statutory returns. A deductor identity is now only
 * ever used when it is complete and well formed; otherwise the return is
 * refused with 422 DEDUCTOR_NOT_CONFIGURED naming what is wrong. Pure: no I/O.
 */
export const DEDUCTOR_NOT_CONFIGURED = "DEDUCTOR_NOT_CONFIGURED";

/** Income-tax TAN: 4 letters, 5 digits, 1 letter (e.g. DELP12345C). */
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
/** Income-tax PAN: 5 letters, 4 digits, 1 letter (e.g. AAAGP1234K). */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** TRACES deductor-name field length. */
export const DEDUCTOR_NAME_MAX = 75;

export interface DeductorIdentity { name: string; tan: string; pan: string }
export interface DeductorInput { name?: string | null | undefined; tan?: string | null | undefined; pan?: string | null | undefined }

/** Well-formed values that are documentation examples / dummies, never a real deductor. */
const PLACEHOLDER_TANS = new Set(["ABCD12345E", "AAAA12345A", "AAAA99999A", "ZZZZ99999Z"]);
const PLACEHOLDER_PANS = new Set(["ABCDE1234F", "AAAAA1234A", "AAAAA9999A", "ZZZZZ9999Z"]);

/** Free-text marker of a placeholder (the old "<... configure EMPLOYER_X>" defaults, "TBD", "XXXX" ...). */
function looksLikePlaceholderText(v: string): boolean {
  return /[<>]/.test(v) || /configure|placeholder|to be (set|configured)/i.test(v) || /^(x+|n\/?a|tbd|na|none|null|test|dummy|-+)$/i.test(v);
}

function isPlaceholderTan(v: string): boolean {
  // The 5-digit sequence number of a real TAN is never 00000; XXXX... is a mask.
  return PLACEHOLDER_TANS.has(v) || v.slice(4, 9) === "00000" || v.startsWith("XXXX");
}

function isPlaceholderPan(v: string): boolean {
  // The 4-digit sequence number of a real PAN is never 0000; XXXXX... is a mask.
  return PLACEHOLDER_PANS.has(v) || v.slice(5, 9) === "0000" || v.startsWith("XXXXX");
}

/** Trim; and for TAN / PAN, upper-case (the form a person types is often lower-case). */
export function normaliseDeductor(i: DeductorInput): { name: string | null; tan: string | null; pan: string | null } {
  const clean = (v: string | null | undefined) => { const t = (v ?? "").trim(); return t === "" ? null : t; };
  return { name: clean(i.name), tan: clean(i.tan)?.toUpperCase() ?? null, pan: clean(i.pan)?.toUpperCase() ?? null };
}

/**
 * Every problem with a (normalised) deductor identity, one message per field,
 * in name / TAN / PAN order. Empty = usable.
 */
export function deductorProblems(i: DeductorInput): string[] {
  const out: string[] = [];
  const name = (i.name ?? "").trim();
  if (!name) out.push("deductor name is missing");
  else if (looksLikePlaceholderText(name)) out.push("deductor name is a placeholder");
  else if (name.length > DEDUCTOR_NAME_MAX) out.push(`deductor name is longer than ${DEDUCTOR_NAME_MAX} characters`);

  const tan = (i.tan ?? "").trim();
  if (!tan) out.push("deductor TAN is missing");
  else if (looksLikePlaceholderText(tan)) out.push("deductor TAN is a placeholder");
  else if (!TAN_RE.test(tan)) out.push(`deductor TAN "${tan}" is not a valid TAN (format AAAA99999A)`);
  else if (isPlaceholderTan(tan)) out.push("deductor TAN is a placeholder");

  const pan = (i.pan ?? "").trim();
  if (!pan) out.push("deductor PAN is missing");
  else if (looksLikePlaceholderText(pan)) out.push("deductor PAN is a placeholder");
  else if (!PAN_RE.test(pan)) out.push(`deductor PAN "${pan}" is not a valid PAN (format AAAAA9999A)`);
  else if (isPlaceholderPan(pan)) out.push("deductor PAN is a placeholder");
  return out;
}

export function deductorNotConfiguredMessage(what: string, problems: readonly string[]): string {
  return `cannot generate ${what}: the TDS deductor is not configured (${problems.join("; ")}). `
    + "Set the tenant deductor with PUT /v1/payroll/settings/deductor { name, tan, pan }.";
}
