/**
 * G6 (Section 8): the sensitive columns of POST /v1/hrms/employees/bulk, kept pure so the validation matrix is
 * unit-testable without a database.
 *
 * Owner decision 5 (10 Nov 2026): PAN, bank account + IFSC and UAN are allowed in bulk import; AADHAAR STAYS OUT.
 *
 *  - Values never appear in an error message: a duplicate / format error names the row and, at most, the LAST FOUR
 *    characters (maskValue), the same convention as every read path.
 *  - Before a row goes on the queue its sensitive fields are sealed with the HRMS envelope (shared/pii-crypto.ts), so
 *    neither the queue (SQS retention, DLQ) nor any log ever holds a clear value. The employee create consumer opens
 *    them again just before the insert, where the `encryptedText` column type seals them for storage.
 */
import { z } from "zod";
import { zIfsc, zUan } from "@civitasone/schemas/validators";
import { encryptPii } from "../../shared/pii-crypto.js";
import { maskValue } from "../../shared/pii-mask.js";

/** The row fields that carry personal / financial data. Order is stable (audit metadata lists names, never values). */
export const SENSITIVE_ROW_FIELDS = ["pan", "uanNumber", "bankAccountNo", "bankIfsc"] as const;
export type SensitiveRowField = (typeof SENSITIVE_ROW_FIELDS)[number];

/** Same PAN shape the single-row create enforces (employee/validators.ts). */
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
/** VERIFY: 9-18 digits is the usual Indian account-number span; confirm against the bank file formats DIC pays through. */
export const BANK_ACCOUNT_RE = /^\d{9,18}$/;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Extra optional columns merged over the existing 11-field row when the flag is on. All optional => backward compatible. */
export const sensitiveRowShape = {
  pan: z.preprocess(blankToUndefined, z.string().trim().transform((v) => v.toUpperCase())
    .refine((v) => PAN_RE.test(v), "PAN must be 10 characters: 5 letters, 4 digits, 1 letter (AAAAA9999A)").optional()),
  uanNumber: z.preprocess(blankToUndefined, zUan.optional()),
  bankAccountNo: z.preprocess(blankToUndefined, z.string().trim()
    .refine((v) => BANK_ACCOUNT_RE.test(v), "bank account number must be 9 to 18 digits").optional()),
  bankIfsc: z.preprocess(blankToUndefined, zIfsc.optional()),
  // Cross-service references: UUIDs for now (a code -> id lookup needs a verified finance / payroll client).
  costCenterId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  payStructureId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
};

/** A key that names an Aadhaar number, however a spreadsheet spells it (aadhaar, Aadhar No, aadhaar_ref, UID ...). */
// Normalised = lowercase letters only; refuse anything containing a spelling of Aadhaar, or starting with "uid".
const AADHAAR_SPELLINGS = ["aadhaar", "aadhar", "adhaar", "adhar"];
const normKey = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
const isAadhaarKey = (k: string) => { const n = normKey(k); return n.startsWith("uid") || AADHAAR_SPELLINGS.some((s) => n.includes(s)); };

/** Field errors for every row that carries an Aadhaar column. Reads KEYS only, never values. */
export function aadhaarColumnErrors(rawEmployees: unknown): Array<{ field: string; message: string }> {
  if (!Array.isArray(rawEmployees)) return [];
  const out: Array<{ field: string; message: string }> = [];
  rawEmployees.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (isAadhaarKey(key)) {
        out.push({ field: `employees.${idx}.${key}`, message: "Aadhaar numbers are not accepted in bulk import; remove this column (add Aadhaar on the employee record instead)." });
      }
    }
  });
  return out;
}

interface RowIdentifiers { pan?: string | undefined; uanNumber?: string | undefined; bankAccountNo?: string | undefined; bankIfsc?: string | undefined }
export interface ExistingIdentifiers { pan: ReadonlySet<string>; uanNumber: ReadonlySet<string>; bankAccountNo: ReadonlySet<string> }

/**
 * Cross-field and duplicate checks: IFSC and account number come as a pair; the same PAN / UAN / account number may
 * not appear twice in the file nor already belong to another employee of the tenant. `existing` is the tenant's
 * current clear values (decrypted by the column type) -- compared in memory, never logged, never echoed.
 */
export function sensitiveRowErrors(
  rows: ReadonlyArray<RowIdentifiers>,
  existing: ExistingIdentifiers,
): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = [];
  const seen = { pan: new Map<string, number>(), uanNumber: new Map<string, number>(), bankAccountNo: new Map<string, number>() };
  const label = { pan: "PAN", uanNumber: "UAN", bankAccountNo: "bank account number" } as const;
  rows.forEach((r, idx) => {
    if (r.bankAccountNo && !r.bankIfsc) errors.push({ field: `employees.${idx}.bankIfsc`, message: "IFSC is required with a bank account number" });
    if (r.bankIfsc && !r.bankAccountNo) errors.push({ field: `employees.${idx}.bankAccountNo`, message: "bank account number is required with an IFSC" });
    for (const f of ["pan", "uanNumber", "bankAccountNo"] as const) {
      const v = r[f];
      if (!v) continue;
      const first = seen[f].get(v);
      if (first !== undefined) {
        errors.push({ field: `employees.${idx}.${f}`, message: `Duplicate ${label[f]} ${maskValue(v)} (also on row ${first + 1} of this file)` });
      } else {
        seen[f].set(v, idx);
        if (existing[f].has(v)) errors.push({ field: `employees.${idx}.${f}`, message: `${label[f]} ${maskValue(v)} already belongs to another employee in this tenant` });
      }
    }
  });
  return errors;
}

/** Names of the sensitive fields present anywhere in the file (for the audit event: names only, never values). */
export function sensitiveFieldsPresent(rows: ReadonlyArray<RowIdentifiers>): SensitiveRowField[] {
  return SENSITIVE_ROW_FIELDS.filter((f) => rows.some((r) => !!r[f]));
}

/** Seal the sensitive fields of a create payload for the queue. Other keys pass through untouched. */
export function sealCreatePayload<T extends Record<string, unknown>>(create: T): T {
  const out: Record<string, unknown> = { ...create };
  for (const f of SENSITIVE_ROW_FIELDS) {
    const v = out[f];
    if (typeof v === "string" && v.length > 0) out[f] = encryptPii(v);
  }
  return out as T;
}

/** Open a sealed payload value (create consumer). Plaintext passes through, so an in-flight pre-deploy message still loads. */
export { decryptPii as openSealed } from "../../shared/pii-crypto.js";
