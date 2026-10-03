import { z } from "zod";

/**
 * Indian vehicle registration numbers (GAP-ASSETS-FLEET-VEHICLES-05).
 *
 * Normalised form is upper-case with spaces/hyphens stripped, e.g. "OD02AB1234".
 * Accepts the standard series (state, 1-2 digit RTO, 0-3 letter series, 4 digits)
 * and the Bharat (BH) series (yy BH nnnn x[x]).
 *
 * POLICY: the pattern is deliberately a named constant -- government/temporary
 * series (defence, diplomatic, "TR" trade/temporary plates) are NOT covered.
 * Set ENFORCE_REGISTRATION_FORMAT to false to fall back to presence-only
 * validation if the owning department needs those series (listed under VERIFY).
 */
export const ENFORCE_REGISTRATION_FORMAT = true;

const STANDARD_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/;
const BH_RE = /^\d{2}BH\d{4}[A-Z]{1,2}$/;

export const REGISTRATION_HINT = "e.g. OD02AB1234";

export function normaliseRegistration(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

export function isValidRegistration(raw: string): boolean {
  const n = normaliseRegistration(raw);
  return STANDARD_RE.test(n) || BH_RE.test(n);
}

/** zod schema: trims/normalises, then (policy permitting) checks the format. */
export const registrationSchema = z
  .string()
  .transform((v) => normaliseRegistration(v))
  .pipe(
    z
      .string()
      .min(1, "Registration number is required.")
      .max(20, "Registration number is too long.")
      .refine((v) => !ENFORCE_REGISTRATION_FORMAT || isValidRegistration(v), {
        message: `Enter a valid registration number (${REGISTRATION_HINT}).`,
      }),
  );

export function parseRegistration(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const r = registrationSchema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid registration number." };
}
