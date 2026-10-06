/**
 * GAP-WORKS-CONTRACTORS-NEW-01: shared, reusable client-side validation for
 * Indian tax identifiers, so the contractor register / edit forms reject a
 * malformed PAN or GSTIN before it enters the contractor master (and later
 * flows into TDS/GST on bills) instead of relying on length-only caps.
 *
 * The regexes mirror the canonical structures already used elsewhere in the
 * app (apps/web/src/app/(app)/billing/gstn/*Panel.tsx's GSTIN_RE) and the
 * works-service contractor validators, and are the same ones the server now
 * enforces (services/works-service/src/modules/contractor/validators.ts) so a
 * value accepted here is accepted there.
 *
 * All identifiers are OPTIONAL (a contractor may be registered with none),
 * matching the existing form + backend behaviour — these schemas only
 * constrain the FORMAT of a value that IS provided; an empty/absent value is
 * valid. Callers that require a value should chain `.min(1)` / mark required.
 */
import { z } from "zod";

/** Indian PAN: 5 letters, 4 digits, 1 letter (10 chars, upper-case). */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Indian GSTIN: 2-digit state code, 10-char PAN, 1 entity char, 'Z',
 * 1 checksum char (15 chars). Matches billing/gstn's GSTIN_RE exactly.
 */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Indian mobile: 10 digits starting 6-9. */
export const MOBILE_RE = /^[6-9][0-9]{9}$/;

export const panSchema = z
  .string()
  .trim()
  .regex(PAN_RE, "Enter a valid 10-character PAN (e.g. ABCDE1234F).");

export const gstinSchema = z
  .string()
  .trim()
  .regex(GSTIN_RE, "Enter a valid 15-character GSTIN (e.g. 29ABCDE1234F1Z5).");

export const mobileSchema = z
  .string()
  .trim()
  .regex(MOBILE_RE, "Enter a valid 10-digit Indian mobile number.");

export const emailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(256);

/** True when GSTIN chars 3–12 (0-indexed 2–11) equal the given PAN. */
export function gstinContainsPan(gstin: string, pan: string): boolean {
  if (!GSTIN_RE.test(gstin) || !PAN_RE.test(pan)) return false;
  return gstin.slice(2, 12) === pan;
}

export type IndianIdFieldErrors = Partial<
  Record<"pan" | "gst" | "phone" | "email", string>
>;

/**
 * Validate the optional identifier fields of a contractor form. Returns a map
 * of field -> message for every invalid, non-empty field (empty/absent fields
 * are skipped — they are optional). Also cross-checks that a GSTIN embeds the
 * supplied PAN when both are present.
 */
export function validateContractorIds(input: {
  pan?: string;
  gst?: string;
  phone?: string;
  email?: string;
}): IndianIdFieldErrors {
  const errors: IndianIdFieldErrors = {};
  const pan = input.pan?.trim() ?? "";
  const gst = input.gst?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const email = input.email?.trim() ?? "";

  if (pan && !panSchema.safeParse(pan).success) {
    errors.pan = "Enter a valid 10-character PAN (e.g. ABCDE1234F).";
  }
  if (gst) {
    if (!gstinSchema.safeParse(gst).success) {
      errors.gst = "Enter a valid 15-character GSTIN (e.g. 29ABCDE1234F1Z5).";
    } else if (pan && panSchema.safeParse(pan).success && !gstinContainsPan(gst, pan)) {
      errors.gst = "GSTIN does not match the PAN entered.";
    }
  }
  if (phone && !mobileSchema.safeParse(phone).success) {
    errors.phone = "Enter a valid 10-digit Indian mobile number.";
  }
  if (email && !emailSchema.safeParse(email).success) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}
