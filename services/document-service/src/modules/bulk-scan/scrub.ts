/**
 * Conservative scrub for free-text that may reach a log line or the failure_detail column.
 * Raw PII must never be logged: long digit runs (Aadhaar / account / phone), emails and PAN-shaped
 * tokens are replaced. The OCR adapter additionally runs the @civitasone/ocr scrub helper before it throws.
 */
export function scrubText(s: string, max = 200): string {
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[pan]")
    .replace(/\d(?:[\s-]?\d){5,}/g, "[digits]")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, max);
}

export function errMessage(e: unknown): string {
  return scrubText(e instanceof Error ? e.message : String(e));
}
