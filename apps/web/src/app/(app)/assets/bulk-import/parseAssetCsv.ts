import { z } from "zod";
import { rupeesToMinorString } from "@/lib/money";

/**
 * GAP-ASSETS-BULK-IMPORT-02: CSV parsing for the bulk asset import.
 *
 * - Quoted fields ("Chair, executive", "45,000") stay one field; "" inside a
 *   quoted field is a literal quote. CRLF and LF line endings both work.
 * - The first row is treated as a header ONLY when its first cell is "name";
 *   pasting rows without a header keeps row 1.
 * - Cost is rupees (₹ sign, spaces and thousands commas allowed) converted to
 *   paise with rupeesToMinorString -- never Number(x) * 100 float maths.
 * - Every row is validated; any error blocks the import and is reported with
 *   the line number the clerk sees in the textarea.
 */

export const ASSET_TYPES = ["fixed", "infra", "movable", "it", "vehicle", "other"] as const;

const rowSchema = z.object({
  name: z.string().min(1, "name is required").max(256, "name is longer than 256 characters"),
  code: z.string().min(1, "code is required").max(64, "code is longer than 64 characters"),
  assetType: z.enum(ASSET_TYPES, {
    errorMap: () => ({ message: `assetType must be one of ${ASSET_TYPES.join(", ")}` }),
  }),
  acquisitionCostMinor: z.number().int().nonnegative().refine(Number.isSafeInteger, "cost is too large"),
  orgUnit: z.string().max(128).optional(),
});

export type AssetCsvRow = z.infer<typeof rowSchema>;
export type AssetCsvError = { line: number; message: string };
/** One parsed line for the pre-import preview: what was read, and why it is (not) importable. */
export type AssetCsvPreviewRow = {
  line: number;
  name: string;
  code: string;
  assetType: string;
  cost: string;
  orgUnit: string;
  /** null = the row is valid; otherwise the reason it blocks the import. */
  error: string | null;
};
export type AssetCsvResult = { rows: AssetCsvRow[]; errors: AssetCsvError[]; preview: AssetCsvPreviewRow[] };

/** Split CSV text into records of fields, tracking each record's starting line (1-based). */
export function splitCsv(text: string): Array<{ line: number; fields: string[] }> {
  const out: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldQuoted = false;

  const endField = () => {
    fields.push(fieldQuoted ? field : field.trim());
    field = "";
    fieldQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (fields.some((f) => f !== "")) out.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") { inQuotes = true; fieldQuoted = true; field = ""; continue; }
    if (ch === ",") { endField(); continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { endRecord(); line++; recordLine = line; continue; }
    field += ch;
  }
  endRecord();
  return out;
}

/** Rupees text ("45,000", "₹ 45,000.50") → paise string, or null if invalid. */
export function costToMinor(raw: string): string | null {
  const cleaned = raw.replace(/₹/g, "").replace(/,/g, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  return rupeesToMinorString(cleaned, { allowZero: true });
}

export function parseAssetCsv(text: string): AssetCsvResult {
  const records = splitCsv(text);
  const rows: AssetCsvRow[] = [];
  const errors: AssetCsvError[] = [];
  const preview: AssetCsvPreviewRow[] = [];
  // GAP-ASSETS-BULK-IMPORT-03: the register enforces unique codes (per tenant,
  // case-insensitive here to match how a clerk reads them) -- a repeat inside
  // the file is flagged on the later line, naming the first.
  const firstLineByCode = new Map<string, number>();
  const first = records[0];
  const body = first && first.fields[0]?.toLowerCase() === "name" ? records.slice(1) : records;

  const fail = (line: number, p: Omit<AssetCsvPreviewRow, "line" | "error">, message: string) => {
    errors.push({ line, message });
    preview.push({ line, ...p, error: message });
  };

  for (const { line, fields } of body) {
    const [name = "", code = "", assetType = "", cost = "", orgUnit = ""] = fields;
    const view = { name, code, assetType: (assetType || "fixed").toLowerCase(), cost, orgUnit };
    if (fields.length > 5) {
      fail(line, view, `expected 5 columns (name,code,assetType,cost,orgUnit), found ${fields.length} — quote values that contain commas`);
      continue;
    }
    const minor = costToMinor(cost);
    if (minor === null) {
      fail(line, view, `cost "${cost}" is not a valid rupee amount`);
      continue;
    }
    const parsed = rowSchema.safeParse({
      name,
      code,
      assetType: view.assetType,
      acquisitionCostMinor: Number(minor),
      orgUnit: orgUnit || undefined,
    });
    if (!parsed.success) {
      fail(line, view, parsed.error.issues.map((i) => i.message).join("; "));
      continue;
    }
    const key = parsed.data.code.toLowerCase();
    const seenAt = firstLineByCode.get(key);
    if (seenAt !== undefined) {
      fail(line, view, `code "${parsed.data.code}" is already used on line ${seenAt}`);
      continue;
    }
    firstLineByCode.set(key, line);
    rows.push(parsed.data);
    preview.push({ line, ...view, error: null });
  }
  return { rows, errors, preview };
}

/**
 * Importable only when there is at least one row and no row errors. Pure
 * client-side parse state -- no fetch is involved -- kept beside the parser.
 */
export function isImportable(result: AssetCsvResult): boolean {
  return result.rows.length > 0 && result.errors.length === 0;
}
