/**
 * Defence-in-depth masking for the scanned-document text preview. document-service already
 * sends a PII-masked excerpt; this re-masks at READ time so a preview that slipped through
 * unmasked (older client, bug) is never shown. Pure, no I/O.
 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const AADHAAR_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
const PHONE_RE = /(?<!\d)(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const LONG_DIGITS_RE = /(?<!\d)\d{9,18}(?!\d)/g;

export function maskPreview(text: string | null): string | null {
  if (text == null) return null;
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(PAN_RE, "[PAN]")
    .replace(AADHAAR_RE, "[Aadhaar]")
    .replace(PHONE_RE, "[phone]")
    .replace(LONG_DIGITS_RE, "[number]")
    .slice(0, 500);
}
