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

export function validateEmail(v: string): string | null {
  if (!v.trim()) return null;
  return EMAIL_RE.test(v.trim()) ? null : "Enter a valid email address.";
}

export function validatePhone(v: string): string | null {
  if (!v.trim()) return null;
  return PHONE_RE.test(v.trim()) ? null : "Enter a valid 10-digit phone number.";
}
