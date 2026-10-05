/**
 * RFC-4180 CSV serialisation with spreadsheet formula-injection protection
 * for the F2 server-side audited exports.
 *
 * Mirrors apps/web/src/lib/csv.ts (and admin-service's guard): every field is
 * quoted, embedded quotes doubled, and a cell a spreadsheet would evaluate as a
 * formula (leading = + - @ TAB or CR) is prefixed with a single quote. Plain
 * numbers / money strings stay numeric so a negative amount is not mangled.
 *
 * The export routes return CSV directly (text/csv) rather than letting the web
 * build a client-side Blob, so the server is the single authority over what
 * leaves the tenant and every download is audited.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;
// Formatted numbers/money ("-5", "-1,234.00", "-₹1,234.00", "-5%") stay numeric.
const PLAIN_NUMBER = /^[-+]?[₹$]?\s?[\d,]+(\.\d+)?%?$/;

/**
 * Neutralise a value a spreadsheet would evaluate as a formula by prefixing an
 * apostrophe (OWASP CSV-injection guidance). Exempt: a lone "-" placeholder and
 * formatted numbers/money.
 */
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

/** Serialise a header row + data rows (arrays of cells) into an RFC-4180 CSV. */
export function toCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const all: ReadonlyArray<ReadonlyArray<unknown>> = [header, ...rows];
  return all.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Column spec: a CSV header name and how to read it from a row object. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Serialise typed row objects through a column spec. */
export function rowsToCsv<T>(columns: ReadonlyArray<CsvColumn<T>>, rows: ReadonlyArray<T>): string {
  const header = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => c.value(row)));
  return toCsv(header, body);
}

/**
 * Build a Content-Disposition attachment filename for an export, timestamped so
 * repeated downloads do not collide and so the file self-documents when it was
 * produced.
 */
export function exportFilename(resource: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${resource}-export-${stamp}.csv`;
}
