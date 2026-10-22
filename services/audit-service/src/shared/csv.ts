/**
 * RFC-4180 CSV serialisation with spreadsheet formula-injection protection for
 * the audit trail's server-side export (GAP-HR-AUDIT-LOG-04).
 *
 * Mirrors apps/web/src/lib/csv.ts and crm-service's shared/csv-export.ts: every
 * field is quoted, embedded quotes are doubled, and a cell a spreadsheet would
 * evaluate as a formula (leading = + - @ TAB or CR) is prefixed with a single
 * quote. Actor names, resource ids and free-text actions all reach this file
 * from other services, so none of them can be trusted not to start with "=".
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
// Formatted numbers ("-5", "-1,234.00", "-5%") stay numeric.
const PLAIN_NUMBER = /^[-+]?[\d,]+(\.\d+)?%?$/;

export function csvFormulaSafe(val: string): string {
  if (!FORMULA_LEAD.test(val)) return val;
  if (val === "-") return val;
  if (PLAIN_NUMBER.test(val)) return val;
  return `'${val}`;
}

export function csvCell(value: unknown): string {
  const s = csvFormulaSafe(value == null ? "" : String(value));
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const all: ReadonlyArray<ReadonlyArray<unknown>> = [header, ...rows];
  return all.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
