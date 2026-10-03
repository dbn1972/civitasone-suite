/**
 * RFC-4180 CSV serialisation with spreadsheet formula-injection protection
 * (GAP-ADMIN-USERS-06). Every field is quoted, embedded quotes are doubled,
 * and a cell that a spreadsheet would evaluate as a formula (leading = + - @
 * TAB or CR) is prefixed with a single quote. Plain numbers such as -5 or
 * +1,200.50 are left alone so negative amounts stay numeric in the export.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
// Formatted numbers/money ("-5", "-1,234.00", "-₹1,234.00", "-5%") stay numeric.
const PLAIN_NUMBER = /^[-+]?[₹$]?\s?[\d,]+(\.\d+)?%?$/;

/**
 * Neutralise a value a spreadsheet would evaluate as a formula by prefixing an
 * apostrophe (OWASP CSV-injection guidance). Exempt: a lone "-" (the
 * empty-value placeholder) and formatted numbers/money. This is the single
 * formula-safety rule; DataTable's csvSafe uses it too.
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

export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
