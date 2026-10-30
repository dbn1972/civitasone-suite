/**
 * Medical insurance — validation, PII handling and the read view.
 *
 * Kept free of Fastify / DB imports so the masking + decrypt-failure rules
 * are unit-testable on their own (see insurance.test.ts); routes.ts and
 * insurance-consumer.ts use these.
 *
 * PII rules (card_number, scheme_id):
 *   - encrypted with the hrms envelope (shared/pii-crypto.ts) in the ROUTE,
 *     before the command is published: plaintext never reaches the queue,
 *     the outbox, the table, the audit payload or a log line;
 *   - the read decrypts per row. Full value for HR roles and for the
 *     employee themself; everyone else (a manager viewing a direct report)
 *     gets maskValue()'s last-4 form;
 *   - a value that cannot be decrypted (tampered row, key-ring gap) never
 *     fails the request: it comes back as null with `decrypt_failed: true`
 *     and `card_number_masked: true`.
 */
import { z } from "zod";
import { decryptPii, encryptPii } from "../../shared/pii-crypto.js";
import { maskValue } from "../../shared/pii-mask.js";

/** Must match medical_insurance_scheme_type_check in migration 0254. */
export const INSURANCE_SCHEME_TYPES = ["cghs", "state_scheme", "group_mediclaim", "esic", "other"] as const;
export type InsuranceSchemeType = (typeof INSURANCE_SCHEME_TYPES)[number];

/** Dependant relations covered by a scheme (the employee themself is implicit). */
export const DEPENDANT_RELATIONS = ["spouse", "child", "parent", "other"] as const;

const isoDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "invalid calendar date");

// Card / scheme ids are alphanumeric with separators. "*" is NOT allowed, so
// a masked placeholder (maskValue output) echoed back by a client can never be
// persisted over the real value.
const idText = (max: number) => z.string().trim().min(4).max(max).regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "letters, digits, space, '.', '/', '-' only");

const dependantSchema = z.object({
  name: z.string().trim().min(1).max(128),
  relation: z.enum(DEPENDANT_RELATIONS),
  dateOfBirth: isoDate.optional(),
}).strict();

export type InsuranceDependant = z.infer<typeof dependantSchema>;

/**
 * PUT /v1/hrms/medical/insurance/:employeeId body.
 *  - cardNumber: required when the employee has no record yet; omit it on an
 *    update to keep the stored one (the UI only ever holds the masked form).
 *  - schemeId: omit to keep, null to clear, a string to set.
 */
export const upsertInsuranceBody = z.object({
  schemeType: z.enum(INSURANCE_SCHEME_TYPES),
  schemeId: idText(64).nullable().optional(),
  cardNumber: idText(64).optional(),
  validityFrom: isoDate,
  validityTo: isoDate.nullable().optional(),
  tier: z.string().trim().min(1).max(64).nullable().optional(),
  dependants: z.array(dependantSchema).max(20).default([]),
  annualLimitMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
}).strict().refine((b) => !b.validityTo || b.validityFrom <= b.validityTo, {
  message: "validityTo must be on or after validityFrom", path: ["validityTo"],
});

export type UpsertInsuranceBody = z.infer<typeof upsertInsuranceBody>;

/** Command payload: ciphertext only, never the plaintext card number / scheme id. */
export interface InsuranceUpsertPayload {
  id: string;
  tenantId: string;
  employeeId: string;
  schemeType: InsuranceSchemeType;
  /** Encrypted card number, or null = keep the stored one (update only). */
  cardNumberEnc: string | null;
  /** "keep" leaves scheme_id untouched; otherwise the new (encrypted or null) value. */
  schemeId: { action: "keep" } | { action: "set"; enc: string | null };
  validityFrom: string;
  validityTo: string | null;
  tier: string | null;
  dependants: InsuranceDependant[];
  /** Paise as a decimal string (bigint-safe on the wire), or null. */
  annualLimitMinor: string | null;
}

export function buildUpsertPayload(
  id: string, tenantId: string, employeeId: string, body: UpsertInsuranceBody,
): InsuranceUpsertPayload {
  return {
    id, tenantId, employeeId,
    schemeType: body.schemeType,
    cardNumberEnc: body.cardNumber ? encryptPii(body.cardNumber) : null,
    schemeId: body.schemeId === undefined
      ? { action: "keep" }
      : { action: "set", enc: body.schemeId === null ? null : encryptPii(body.schemeId) },
    validityFrom: body.validityFrom,
    validityTo: body.validityTo ?? null,
    tier: body.tier ?? null,
    dependants: body.dependants,
    annualLimitMinor: body.annualLimitMinor == null ? null : String(body.annualLimitMinor),
  };
}

/** Row shape of the GET query (snake_case, as the route always returned). */
export interface InsuranceDbRow {
  employee_id: string;
  scheme_type: string;
  scheme_id: string | null;
  card_number: string | null;
  validity_from: string | null;
  validity_to: string | null;
  tier: string | null;
  dependants: unknown;
  annual_limit_minor: string | null;
  version?: number | null;
  updated_at?: string | Date | null;
}

export interface InsuranceView {
  employee_id: string;
  scheme_type: string;
  scheme_id: string | null;
  card_number: string | null;
  /** true when card_number / scheme_id are shown masked (or withheld). */
  card_number_masked: boolean;
  /** true when the stored ciphertext could not be decrypted. */
  decrypt_failed: boolean;
  validity_from: string | null;
  validity_to: string | null;
  tier: string | null;
  dependants: Array<Partial<InsuranceDependant>>;
  dependants_count: number;
  annual_limit_minor: string | null;
  version: number | null;
  updated_at: string | Date | null;
}

type DecryptResult = { ok: true; value: string | null } | { ok: false };

function tryDecrypt(stored: string | null): DecryptResult {
  if (stored === null || stored === undefined || stored === "") return { ok: true, value: null };
  try {
    return { ok: true, value: decryptPii(stored) };
  } catch {
    return { ok: false };
  }
}

/**
 * Build the response for one row. `fullAccess` = HR role or the employee
 * themself. Non-full-access callers also get dependants reduced to their
 * relation (no names / dates of birth of family members).
 * `onDecryptFailure` is called (once) with no value -- for a log line.
 */
export function toInsuranceView(
  row: InsuranceDbRow,
  fullAccess: boolean,
  onDecryptFailure?: () => void,
): InsuranceView {
  const card = tryDecrypt(row.card_number);
  const scheme = tryDecrypt(row.scheme_id);
  const failed = !card.ok || !scheme.ok;
  if (failed) onDecryptFailure?.();

  const show = (r: DecryptResult): string | null => {
    if (!r.ok) return null;
    if (r.value === null) return null;
    return fullAccess ? r.value : (maskValue(r.value) ?? null);
  };

  const deps = Array.isArray(row.dependants) ? (row.dependants as InsuranceDependant[]) : [];
  const count = Array.isArray(row.dependants)
    ? deps.length
    : typeof row.dependants === "number" ? row.dependants : 0;

  return {
    employee_id: row.employee_id,
    scheme_type: row.scheme_type,
    scheme_id: show(scheme),
    card_number: show(card),
    card_number_masked: failed || !fullAccess,
    decrypt_failed: failed,
    validity_from: row.validity_from,
    validity_to: row.validity_to,
    tier: row.tier,
    dependants: fullAccess ? deps : deps.map((d) => ({ relation: d.relation })),
    dependants_count: count,
    annual_limit_minor: row.annual_limit_minor,
    version: row.version ?? null,
    updated_at: row.updated_at ?? null,
  };
}
