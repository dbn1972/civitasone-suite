/**
 * lead-ingestion — file parsing + column mapping + per-row validation.
 *
 * Pure(ish) and dependency-injected: CSV is parsed by a small robust hand-rolled
 * parser (RFC-4180-ish: quoted fields, embedded commas/newlines, doubled-quote
 * escapes, CR/LF); XLSX is parsed via `exceljs` (a declared workspace dep) loaded
 * lazily so tests that only exercise CSV never touch it.
 *
 * Mapping turns a file column-name → a CRM lead field in {name,email,mobile,
 * company,city}. Each mapped row is validated to the SAME shape the CRM contact
 * schema accepts (DQ-003 mobile format, email, length caps) so a bad row is
 * counted and dropped — never shipped downstream to abort a whole batch.
 */

/** A CRM lead field this connector can map onto. */
export type LeadField = "name" | "email" | "mobile" | "company" | "city";

/** file-column-name → lead field. */
export type ColumnMapping = Record<string, LeadField>;

/** A contact shaped for POST /v1/crm/contacts/bulk/import/internal. */
export interface MappedContact {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  city?: string;
}

export interface MapResult {
  contacts: MappedContact[];
  /** rows that produced no valid contact, with a machine-readable reason. */
  bad: Array<{ row: number; reason: string }>;
}

// DQ-003 Indian mobile (mirrors crm format-validators MOBILE_RE).
const MOBILE_RE = /^(\+91)?[6-9]\d{9}$/;
// Pragmatic email check (crm uses zod .email(); this is a close, permissive mirror).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse CSV text into rows of string cells. Handles quoted fields with embedded
 * commas, newlines and doubled-quote ("") escapes; tolerates CRLF and a
 * trailing newline. Returns [] for empty input.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  // Strip a UTF-8 BOM if present.
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;
  let sawAny = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  for (; i < n; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAny = true; continue; }
    if (ch === ",") { pushField(); sawAny = true; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushField(); pushRow(); sawAny = false;
      continue;
    }
    field += ch; sawAny = true;
  }
  // Flush the last field/row unless the input ended exactly on a row boundary.
  if (sawAny || field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

/** Parse an XLSX buffer's first worksheet into rows of string cells. */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const mod = (await import("exceljs")) as unknown as { default: { Workbook: new () => any } };
  const wb = new mod.default.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r: any) => {
    const cells: string[] = [];
    // exceljs values is 1-indexed (values[0] is undefined); normalise to strings.
    const values = r.values as unknown[];
    for (let c = 1; c < values.length; c++) {
      const v = values[c];
      cells.push(cellToString(v));
    }
    out.push(cells);
  });
  return out;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  // exceljs rich-text / hyperlink / formula cell objects.
  const o = v as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  if (typeof o.result === "string" || typeof o.result === "number") return String(o.result);
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? "").join("");
  return String(v);
}

/**
 * Map header+data rows into validated contacts using `columnMapping`.
 * The first row is treated as the header. Column names are matched
 * case-insensitively and trimmed.
 */
export function mapAndValidate(rows: string[][], columnMapping: ColumnMapping): MapResult {
  const contacts: MappedContact[] = [];
  const bad: MapResult["bad"] = [];
  if (rows.length === 0) return { contacts, bad };

  const header = rows[0]!.map((h) => h.trim());
  // Normalise the mapping keys for case-insensitive lookup.
  const normMap = new Map<string, LeadField>();
  for (const [col, field] of Object.entries(columnMapping)) normMap.set(col.trim().toLowerCase(), field);
  // header index → lead field
  const colField: Array<LeadField | undefined> = header.map((h) => normMap.get(h.toLowerCase()));

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const rec: Partial<Record<LeadField, string>> = {};
    for (let c = 0; c < colField.length; c++) {
      const f = colField[c];
      if (!f) continue;
      const raw = (cells[c] ?? "").trim();
      if (raw !== "") rec[f] = raw;
    }
    const v = validateRow(rec);
    if ("error" in v) bad.push({ row: r, reason: v.error });
    else contacts.push(v.contact);
  }
  return { contacts, bad };
}

type RowOutcome = { contact: MappedContact } | { error: string };

/** Validate one mapped record to the CRM-accepted contact shape (DQ-003). */
export function validateRow(rec: Partial<Record<LeadField, string>>): RowOutcome {
  const name = rec.name?.trim();
  if (!name) return { error: "missing_name" };
  if (name.length > 200) return { error: "name_too_long" };
  const contact: MappedContact = { name };
  if (rec.email) {
    if (rec.email.length > 320 || !EMAIL_RE.test(rec.email)) return { error: "invalid_email" };
    contact.email = rec.email;
  }
  if (rec.mobile) {
    if (!MOBILE_RE.test(rec.mobile)) return { error: "invalid_mobile" };
    contact.phone = rec.mobile;
  }
  if (rec.company) {
    if (rec.company.length > 200) return { error: "company_too_long" };
    contact.company = rec.company;
  }
  if (rec.city) {
    if (rec.city.length > 100) return { error: "city_too_long" };
    contact.city = rec.city;
  }
  return { contact };
}

/** Choose a parser from the filename extension. */
export async function parseFile(filename: string, buf: Buffer): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsx(buf);
  // default: CSV (covers .csv and anything the pattern let through).
  return parseCsv(buf.toString("utf8"));
}
