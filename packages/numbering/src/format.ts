/**
 * Pure reference-string formatting: financial-year derivation, reset-bucket
 * keys, and the final formatted reference. No I/O, fully deterministic — the
 * heart of what makes numbering reusable across every service.
 */
import type { NumberFormatSpec } from "./spec.js";

/**
 * Financial-year label for `date` given a first-month, e.g. April-start (4):
 * 2026-03-31 -> "2025-26", 2026-04-01 -> "2026-27". A January start (1)
 * degenerates to the calendar year, "2026-27" style still (start-endShort).
 */
export function financialYear(date: Date, fyStartMonth: number): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1; // 1-12
  const startYear = m >= fyStartMonth ? y : y - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2).padStart(2, "0")}`;
}

/** Zero-pad a sequence value to `width` digits (never truncates a larger value). */
export function formatSequence(seq: bigint | number, width: number): string {
  const s = (typeof seq === "bigint" ? seq : BigInt(Math.trunc(seq))).toString();
  return s.padStart(width, "0");
}

/**
 * Reset-bucket key for `date` under `spec.resetPolicy`. Concurrent allocations
 * sharing a bucket share (and increment) one counter row; a new bucket starts
 * the counter fresh at 1.
 *   - never   -> "ALL"
 *   - yearly  -> financial year ("2026-27") if embedFinancialYear else calendar year
 *   - monthly -> "YYYY-MM" (calendar month)
 */
export function resetBucket(spec: NumberFormatSpec, date: Date): string {
  switch (spec.resetPolicy) {
    case "never":
      return "ALL";
    case "monthly": {
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, "0");
      return `${y}-${m}`;
    }
    case "yearly":
    default:
      return spec.embedFinancialYear
        ? financialYear(date, spec.fyStartMonth)
        : String(date.getUTCFullYear());
  }
}

export interface FormatOptions {
  /** Timestamp the reference is minted for (defaults to now). */
  at?: Date;
  /**
   * Override the middle (year/period) segments. When provided these replace the
   * financial-year segment entirely — lets a caller reproduce a legacy layout
   * such as `PO/2026/0001` (single calendar-year segment) exactly.
   */
  segments?: string[];
}

/**
 * Compose the final reference string, e.g. `PO/2026-27/000123`.
 * Segment order: prefix, then year/period segment(s), then the padded counter.
 */
export function formatReference(spec: NumberFormatSpec, seq: bigint | number, opts: FormatOptions = {}): string {
  const at = opts.at ?? new Date();
  const parts: string[] = [];
  if (spec.prefix) parts.push(spec.prefix);
  if (opts.segments) {
    for (const s of opts.segments) if (s) parts.push(s);
  } else if (spec.embedFinancialYear) {
    parts.push(financialYear(at, spec.fyStartMonth));
  }
  parts.push(formatSequence(seq, spec.counterWidth));
  return parts.join(spec.separator);
}
