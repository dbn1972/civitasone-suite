/**
 * GAP-ANALYTICS-DATA-WAREHOUSE-01: "Total Records" used to be
 * sum(parseInt(records.replace(/[^0-9]/g,""),10)), which silently corrupts
 * any non-plain-digit value: "1.2 M" -> 12, "2 Cr" -> 2. The analytics API
 * returns a plain integer string today, but the field is typed `string`, so
 * parse defensively: accept ONLY plain digits (optionally Indian-grouped with
 * commas) and treat anything else as unknown rather than fabricating a number.
 */

/** Parse a record-count string to an integer, or null if not a plain count. */
export function parseRecordCount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^[\d,]+$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type RecordTotal = { total: number; partial: boolean };

/**
 * Sum the parseable record counts. `partial` is true when at least one row's
 * value could not be read, so the caller can show the total as unavailable
 * rather than a misleadingly-low number.
 */
export function sumRecordCounts(rawValues: Array<string | null | undefined>): RecordTotal {
  let total = 0;
  let partial = false;
  for (const raw of rawValues) {
    const n = parseRecordCount(raw);
    if (n === null) partial = true;
    else total += n;
  }
  return { total, partial };
}
