/**
 * PII masking utility — strips or masks sensitive fields before API responses.
 *
 * SECURITY: PII columns (pan, aadhaarRef, bankAccountNo, bankIfsc, mobile) must
 * NEVER be returned in full in any API response. This module provides:
 *   - maskValue: masks all but last 4 chars (e.g. "ABCDE1234F" → "******1234F")
 *   - stripPii: removes PII fields entirely from an employee record
 *   - maskPii: replaces PII fields with masked versions (for self-service/admin)
 */

/** PII field keys that must be masked or stripped in API responses. */
const PII_FIELDS = ["pan", "aadhaarRef", "bankAccountNo", "bankIfsc", "mobile"] as const;

/**
 * Mask a string value, showing only the last `visibleChars` characters.
 * Returns undefined if the input is null/undefined/empty.
 */
export function maskValue(value: string | null | undefined, visibleChars = 4): string | undefined {
  if (!value || value.length === 0) return undefined;
  if (value.length <= visibleChars) return "*".repeat(value.length);
  const masked = "*".repeat(value.length - visibleChars) + value.slice(-visibleChars);
  return masked;
}

/**
 * Strip all PII fields from an employee record. Returns a new object
 * without pan, aadhaarRef, bankAccountNo, bankIfsc, mobile.
 * Safe for list endpoints and non-privileged access.
 */
export function stripPii<T extends Record<string, unknown>>(record: T): Omit<T, typeof PII_FIELDS[number]> {
  const result = { ...record };
  for (const field of PII_FIELDS) {
    delete (result as Record<string, unknown>)[field];
  }
  return result as Omit<T, typeof PII_FIELDS[number]>;
}

/**
 * Mask PII fields in an employee record (show last 4 chars only).
 * Suitable for self-service (employee viewing their own record) or admin detail views.
 */
export function maskPii<T extends Record<string, unknown>>(record: T): T {
  const result = { ...record };
  for (const field of PII_FIELDS) {
    const val = (result as Record<string, unknown>)[field];
    if (typeof val === "string" && val.length > 0) {
      (result as Record<string, unknown>)[field] = maskValue(val);
    }
  }
  return result as T;
}
