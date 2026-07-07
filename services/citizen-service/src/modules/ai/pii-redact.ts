/**
 * PII Redaction — strips personally identifiable information before sending to LLM.
 *
 * Patterns redacted:
 *   - Aadhaar: 12 digits (optionally space-separated 4-4-4) → [AADHAAR]
 *   - PAN: 5 uppercase letters + 4 digits + 1 uppercase letter → [PAN]
 *   - Phone numbers: 10 consecutive digits → [PHONE]
 *   - Email: standard email pattern → [EMAIL]
 *
 * Validates: Requirements 20.7
 */

/** Aadhaar: 4 digits + optional space + 4 digits + optional space + 4 digits */
const AADHAAR_PATTERN = /\b\d{4}\s?\d{4}\s?\d{4}\b/g;

/** PAN: 5 uppercase letters + 4 digits + 1 uppercase letter */
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/g;

/** Phone: exactly 10 consecutive digits (not part of a longer number) */
const PHONE_PATTERN = /\b\d{10}\b/g;

/** Email: standard email regex */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

/**
 * Strip all PII from the given text and replace with placeholder tokens.
 *
 * Order matters: Aadhaar (12 digits with spaces) is checked before phone (10 digits)
 * to avoid partial matches.
 */
export function redactPii(text: string): string {
  let result = text;

  // 1. Aadhaar (before phone to avoid substring matches)
  result = result.replace(AADHAAR_PATTERN, "[AADHAAR]");

  // 2. PAN
  result = result.replace(PAN_PATTERN, "[PAN]");

  // 3. Phone (10 digits — must come after Aadhaar replacement)
  result = result.replace(PHONE_PATTERN, "[PHONE]");

  // 4. Email
  result = result.replace(EMAIL_PATTERN, "[EMAIL]");

  return result;
}
