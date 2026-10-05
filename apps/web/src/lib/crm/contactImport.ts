/**
 * CRM bulk-import CSV parsing + validation (GAP-CRM-CONTACTS-IMPORT-01).
 *
 * The New Contact form enforces lead-status validity, phone/email format and a
 * marketing-consent default; bulk import must apply the SAME rules client-side
 * so a bad or non-consented row never reaches POST /v1/crm/contacts/bulk/import
 * (DPDP: non-consented contacts must not be silently created and later
 * marketed to). The server re-validates with zod — this is defence in depth,
 * not the only gate.
 *
 * `parseContactCsv` returns the valid rows AND a per-line `rejected` list with a
 * human reason, so the import page can show exactly which rows were dropped and
 * why instead of a bare "N rows skipped".
 */
import { LEAD_STATUSES, type LeadStatus } from "./leadQualification";

/** CSV header columns, in order. `marketingConsent` is optional and defaults to false. */
export const IMPORT_COLUMNS = [
  "name",
  "email",
  "phone",
  "company",
  "leadStatus",
  "marketingConsent",
] as const;

/** A validated, import-ready contact row. */
export interface ImportContact {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  leadStatus: LeadStatus;
  /** Explicit DPDP marketing-consent flag — defaults to false when the column is absent/blank. */
  marketingConsent: boolean;
}

/** A row that failed validation, with its 1-based CSV data line and a reason. */
export interface RejectedRow {
  line: number;
  reason: string;
}

export interface ParseResult {
  rows: ImportContact[];
  rejected: RejectedRow[];
}

/** 10-digit Indian mobile, first digit 6-9 (mirrors INVALID_MOBILE on the New form). */
export function isValidMobile(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value.trim());
}

/** Pragmatic email shape check (one @, a dot in the domain, no spaces). */
export function isValidEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Parse a truthy/falsy consent cell. Blank or absent → false (safest default). */
export function parseConsent(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1";
}

function isLeadStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

/**
 * RFC 4180 CSV tokeniser (GAP-CRM-CONTACTS-IMPORT-03). Splits the whole
 * document into records of fields, honouring:
 *   - double-quoted fields that may contain commas, CR, LF;
 *   - escaped quotes inside a quoted field ("" -> ");
 *   - CRLF or LF line endings (a trailing \r on an unquoted field is stripped).
 * A record is one logical row even when it spans multiple physical lines
 * (a quoted newline). Returns `[]` for empty input.
 */
export function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyField = false;

  const pushField = () => {
    record.push(inQuotes ? field : field.replace(/\r$/, ""));
    field = "";
    sawAnyField = true;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    sawAnyField = false;
  };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false; // closing quote
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { pushField(); continue; }
    if (ch === "\n") { pushRecord(); continue; }
    field += ch;
  }
  // Flush the final record unless the input ended on a clean record boundary
  // (i.e. nothing pending). A pending field OR a partially-built record counts.
  if (field !== "" || record.length > 0 || sawAnyField) pushRecord();
  return records;
}

/** True when a parsed first row looks like the header (its cells match IMPORT_COLUMNS names). */
export function looksLikeHeader(cells: string[]): boolean {
  const known = new Set<string>(IMPORT_COLUMNS as readonly string[]);
  const normalised = cells.map((c) => c.trim().toLowerCase());
  // Header if at least the first two cells are known column names (so a data
  // row that happens to start with a real name/email is not mistaken for one).
  return normalised.length > 0 && normalised.slice(0, 2).every((c) => known.has(c));
}

/**
 * Parse and validate the import CSV (GAP-CRM-CONTACTS-IMPORT-01 / -03). The
 * document is tokenised RFC-4180-style so a quoted comma
 * (`"Housing & Urban Development, Odisha"`) stays ONE field instead of shifting
 * every later column. The first record is treated as a header ONLY when it
 * looks like one ({@link looksLikeHeader}); otherwise it is kept as data so a
 * header-less file does not silently lose its first contact. A record with more
 * fields than columns is rejected with its line number rather than importing
 * misplaced values into the wrong contact fields.
 */
export function parseContactCsv(csv: string): ParseResult {
  const records = parseCsvRecords(csv);
  const rows: ImportContact[] = [];
  const rejected: RejectedRow[] = [];
  if (records.length === 0) return { rows, rejected };

  // Header detection: skip the first record only when it looks like a header.
  const hasHeader = looksLikeHeader(records[0]);
  const dataRecords = hasHeader ? records.slice(1) : records;

  dataRecords.forEach((cells, idx) => {
    // Report the real 1-based line number within the data section.
    const dataLineNo = idx + 1;
    // A record that is entirely empty (a blank physical line) is skipped.
    if (cells.length === 0 || cells.every((c) => c.trim() === "")) return;

    // GAP-CRM-CONTACTS-IMPORT-03: too many columns means a quoting/column error
    // upstream — reject rather than import shifted values into the wrong fields.
    if (cells.length > IMPORT_COLUMNS.length) {
      rejected.push({
        line: dataLineNo,
        reason: `Too many columns (${cells.length}; expected at most ${IMPORT_COLUMNS.length}). Check for an unquoted comma.`,
      });
      return;
    }

    const trimmed = cells.map((s) => s.trim());
    const [name, email, phone, company, leadStatus, marketingConsent] = trimmed;

    if (!name) {
      rejected.push({ line: dataLineNo, reason: "Missing name." });
      return;
    }

    const status = (leadStatus || "new");
    if (!isLeadStatus(status)) {
      rejected.push({
        line: dataLineNo,
        reason: `Invalid lead status "${leadStatus}" (allowed: ${LEAD_STATUSES.join(", ")}).`,
      });
      return;
    }

    if (email && !isValidEmail(email)) {
      rejected.push({ line: dataLineNo, reason: `Invalid email "${email}".` });
      return;
    }

    if (phone && !isValidMobile(phone)) {
      rejected.push({ line: dataLineNo, reason: `Invalid phone "${phone}" (expected a 10-digit mobile).` });
      return;
    }

    rows.push({
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      leadStatus: status,
      marketingConsent: parseConsent(marketingConsent),
    });
  });

  return { rows, rejected };
}
