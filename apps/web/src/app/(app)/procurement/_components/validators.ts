/** Client-side field validators for Indian government procurement forms. */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9]{10}$/;

export function validateGstin(v: string): string | null {
  if (!v.trim()) return null; // optional
  return GSTIN_RE.test(v.trim().toUpperCase()) ? null : "Enter a valid 15-character GSTIN.";
}

export function validatePan(v: string): string | null {
  if (!v.trim()) return null;
  return PAN_RE.test(v.trim().toUpperCase()) ? null : "Enter a valid 10-character PAN (e.g. ABCDE1234F).";
}

export function validateIfsc(v: string): string | null {
  if (!v.trim()) return null;
  return IFSC_RE.test(v.trim().toUpperCase()) ? null : "Enter a valid 11-character IFSC code.";
}

// ---- GAP-PROCUREMENT-VENDORS-NEW-02: GSTIN checksum + state + PAN match -----

const GSTIN_CHECK_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // base-36

/**
 * GSTN mod-36 check-digit on the 15th character. Each of the first 14 chars is
 * valued 0-35; weighted alternately ×1/×2; a ×2 product is reduced as
 * floor(p/36)+p%36; the sum's complement to the next multiple of 36 (mod 36)
 * gives the expected 15th char. Returns true when the supplied 15th char
 * matches. (Standard algorithm — validated against known-good samples in the
 * co-located test.)
 */
export function isGstinChecksumValid(gstin: string): boolean {
  const g = gstin.trim().toUpperCase();
  if (g.length !== 15) return false;
  const cp = GSTIN_CHECK_ALPHABET.length; // 36
  let factor = 2;
  let sum = 0;
  // Iterate the first 14 characters right-to-left; factor alternates 2,1,2,1…
  for (let i = 13; i >= 0; i--) {
    const code = GSTIN_CHECK_ALPHABET.indexOf(g[i]);
    if (code < 0) return false;
    let digit = factor * code;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / cp) + (digit % cp);
    sum += digit;
  }
  const checkCode = (cp - (sum % cp)) % cp;
  return GSTIN_CHECK_ALPHABET[checkCode] === g[14];
}

/** Valid GSTIN state codes: 01-38, plus 97 (Other Territory) and 99 (Centre). */
function isValidGstinStateCode(gstin: string): boolean {
  const code = Number(gstin.slice(0, 2));
  if (Number.isNaN(code)) return false;
  return (code >= 1 && code <= 38) || code === 97 || code === 99;
}

/** Characters 3-12 of a GSTIN are the holder's PAN. */
export function gstinToPan(gstin: string): string {
  return gstin.trim().toUpperCase().slice(2, 12);
}

/**
 * Full GSTIN validation: format + state code + mod-36 checksum. Still optional
 * (empty passes) so the field can be left blank; a non-empty value must be a
 * real GSTIN, not merely regex-shaped.
 */
export function validateGstinStrict(v: string): string | null {
  if (!v.trim()) return null;
  const g = v.trim().toUpperCase();
  if (!GSTIN_RE.test(g)) return "Enter a valid 15-character GSTIN.";
  if (!isValidGstinStateCode(g)) return "GSTIN state code is not valid (expected 01-38, 97 or 99).";
  if (!isGstinChecksumValid(g)) return "GSTIN check digit is invalid — please re-check the number.";
  return null;
}

/**
 * When BOTH GSTIN and PAN are present they must agree: chars 3-12 of the GSTIN
 * are the PAN. Returns an error string for the PAN field on mismatch.
 */
export function validateGstinPanMatch(gstin: string, pan: string): string | null {
  const g = gstin.trim().toUpperCase();
  const p = pan.trim().toUpperCase();
  if (!g || !p) return null;
  if (!GSTIN_RE.test(g) || !PAN_RE.test(p)) return null; // format errors reported by their own validators
  return gstinToPan(g) === p ? null : "PAN does not match the PAN embedded in the GSTIN.";
}

export function validateEmail(v: string): string | null {
  if (!v.trim()) return null;
  return EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address.";
}

export function validatePhone(v: string): string | null {
  if (!v.trim()) return null;
  return PHONE_RE.test(v.trim()) ? null : "Enter a valid 10-digit phone number.";
}

// ---- GAP-PROCUREMENT-VENDORS-NEW-05: phone normalization --------------------

/**
 * Strip spaces/hyphens/brackets and a leading +91, 91 or 0, returning the bare
 * digits. "+91 98765 43210" -> "9876543210", "098765-43210" -> "9876543210".
 * Returns the cleaned digit string (may be <10 if input was short).
 */
export function normalizePhone(v: string): string {
  let digits = v.replace(/[^\d]/g, "");
  if (digits.length > 10) {
    if (digits.startsWith("91")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * Validate a phone after normalization: a 10-digit Indian mobile ([6-9] start).
 * Accepts +91/91/0 prefixes and separators. Returns an error string or null.
 */
export function validateMobileNormalized(v: string): string | null {
  if (!v.trim()) return null;
  const d = normalizePhone(v);
  return MOBILE_RE.test(d) ? null : "Enter a valid 10-digit mobile number (+91 optional).";
}

// ---- GAP-PROCUREMENT-VENDORS-NEW-01: bank account number --------------------

const ACCOUNT_RE = /^\d{9,18}$/;

/** A bank account number: 9-18 digits (digits only). Optional when blank. */
export function validateAccountNo(v: string): string | null {
  if (!v.trim()) return null;
  return ACCOUNT_RE.test(v.trim()) ? null : "Enter a valid account number (9-18 digits).";
}
