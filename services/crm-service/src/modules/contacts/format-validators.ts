/**
 * Reusable Indian-format field validators (DQ-003).
 *
 * Pure, dependency-free predicates over the canonical Indian identifier formats.
 * Kept separate from any zod/route code so they can be unit-tested in isolation
 * and reused by contacts, leads and accounts schemas alike.
 *
 * A value is validated only when PRESENT — emptiness/optionality is the caller's
 * concern (these return `true` for null/undefined/empty so an optional-but-absent
 * field is never flagged as an invalid format).
 */

/** True for null | undefined | "" — i.e. "nothing to validate". */
function absent(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Indian mobile number. Accepts an optional +91 country code followed by a
 * 10-digit number whose first digit is 6-9 (TRAI mobile numbering).
 * Examples: "+919876543210", "9876543210".
 */
export const MOBILE_RE = /^(\+91)?[6-9]\d{9}$/;

/** Indian PIN code: 6 digits, first digit 1-9 (no leading zero). */
export const PINCODE_RE = /^[1-9]\d{5}$/;

/**
 * GSTIN: 15 chars — 2-digit state code, 5 letters (PAN block), 4 digits,
 * 1 letter (PAN entity), 1 entity-number char (1-9 or A-Z), literal 'Z',
 * 1 checksum char (0-9 or A-Z).
 */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** PAN: 5 letters, 4 digits, 1 letter. */
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

export function isValidMobile(value: unknown): boolean {
  if (absent(value)) return true;
  return typeof value === "string" && MOBILE_RE.test(value.trim());
}

export function isValidPincode(value: unknown): boolean {
  if (absent(value)) return true;
  return typeof value === "string" && PINCODE_RE.test(value.trim());
}

export function isValidGstin(value: unknown): boolean {
  if (absent(value)) return true;
  return typeof value === "string" && GSTIN_RE.test(value.trim().toUpperCase());
}

export function isValidPan(value: unknown): boolean {
  if (absent(value)) return true;
  return typeof value === "string" && PAN_RE.test(value.trim().toUpperCase());
}

/** Distinct machine-readable error codes surfaced to the client (400). */
export const FORMAT_ERROR_CODES = {
  mobile: "INVALID_MOBILE",
  pincode: "INVALID_PINCODE",
  gstin: "INVALID_GSTIN",
  pan: "INVALID_PAN",
} as const;

export interface FormatFieldSpec {
  /** The field name on the object being validated. */
  field: string;
  /** The predicate that must hold for a present value. */
  check: (value: unknown) => boolean;
  /** The distinct error code / message emitted when the value is invalid. */
  code: string;
}

/** The standard set of format checks, mapped to their fields on a contact. */
export const CONTACT_FORMAT_SPECS: readonly FormatFieldSpec[] = [
  { field: "phone", check: isValidMobile, code: FORMAT_ERROR_CODES.mobile },
  { field: "pincode", check: isValidPincode, code: FORMAT_ERROR_CODES.pincode },
  { field: "gstin", check: isValidGstin, code: FORMAT_ERROR_CODES.gstin },
  { field: "pan", check: isValidPan, code: FORMAT_ERROR_CODES.pan },
] as const;

/** Account-level checks (business identifiers only). */
export const ACCOUNT_FORMAT_SPECS: readonly FormatFieldSpec[] = [
  { field: "gstin", check: isValidGstin, code: FORMAT_ERROR_CODES.gstin },
  { field: "pan", check: isValidPan, code: FORMAT_ERROR_CODES.pan },
] as const;

/**
 * Evaluate every spec against `obj` and return the list of violations.
 * A pure helper the zod `superRefine` layers call — also directly unit-testable
 * and reused by the data-quality dashboard's "invalid" detection (DQ-004).
 */
export function collectFormatViolations(
  obj: Record<string, unknown>,
  specs: readonly FormatFieldSpec[] = CONTACT_FORMAT_SPECS,
): Array<{ field: string; code: string }> {
  const out: Array<{ field: string; code: string }> = [];
  for (const spec of specs) {
    if (!spec.check(obj[spec.field])) {
      out.push({ field: spec.field, code: spec.code });
    }
  }
  return out;
}
