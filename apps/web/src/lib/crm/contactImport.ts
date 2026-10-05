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
 * Parse and validate the import CSV. The first line is treated as a header and
 * skipped. Each subsequent non-empty line must have a name, a lead status that
 * is one of {@link LEAD_STATUSES}, and — when present — a well-formed phone and
 * email. Rejected rows are reported with their 1-based data line number.
 */
export function parseContactCsv(csv: string): ParseResult {
  const allLines = csv.split("\n");
  // Drop the header row; keep original index so we can report real line numbers.
  const dataLines = allLines.slice(1);
  const rows: ImportContact[] = [];
  const rejected: RejectedRow[] = [];

  dataLines.forEach((rawLine, idx) => {
    const line = rawLine.trim();
    const dataLineNo = idx + 1;
    if (!line) return; // blank line — not an error, just skip
    const cells = rawLine.split(",").map((s) => s.trim());
    const [name, email, phone, company, leadStatus, marketingConsent] = cells;

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
