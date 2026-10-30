/**
 * Medical insurance — validation, PII handling and the read view.
 *
 * Kept free of Fastify / DB imports so the masking + decrypt-failure rules
 * are unit-testable on their own; routes.ts and insurance-consumer.ts use these.
 *
 * PII rules (owner decision on PR #2397):
 *   - card_number, scheme_id and every dependant's name / date of birth are
 *     encrypted with the hrms envelope (shared/pii-crypto.ts) in the ROUTE,
 *     before the command is published: plaintext never reaches the queue,
 *     the outbox, the table, the audit payload or a log line. A dependant's
 *     relation stays plaintext.
 *   - GET returns card_number / scheme_id in full ONLY to the employee
 *     themself (owner-approved); everyone else, HR included, gets them
 *     masked to the last 4. HR's clear value is the audited SF-05a-style
 *     POST /v1/hrms/medical/insurance/:employeeId/reveal (hr_admin /
 *     super_admin, the PAN / bank reveal tier).
 *   - dependants: the HR write tier (hr_admin / hr_officer / super_admin)
 *     and the employee themself see decrypted names / dates of birth; anyone
 *     else (manager, finance_officer) sees the relation only.
 *   - a value that cannot be decrypted (tampered row, key-ring gap) never
 *     fails the request: it comes back as null with `decrypt_failed: true`
 *     (per dependant as well as on the record).
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

/** A dependant as stored / carried on the command: name and dateOfBirth are ciphertext envelopes. */
export interface StoredDependant {
  relation: (typeof DEPENDANT_RELATIONS)[number];
  name: string;
  dateOfBirth?: string;
}

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
  /** Names / dates of birth already encrypted. */
  dependants: StoredDependant[];
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
    dependants: body.dependants.map((d) => ({
      relation: d.relation,
      name: encryptPii(d.name),
      ...(d.dateOfBirth ? { dateOfBirth: encryptPii(d.dateOfBirth) } : {}),
    })),
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

/** A dependant in the GET response. name / dateOfBirth only for full-access callers. */
export interface DependantView {
  relation: string;
  name?: string | null;
  dateOfBirth?: string | null;
  decrypt_failed?: boolean;
}

export interface InsuranceView {
  employee_id: string;
  scheme_type: string;
  /** Masked (last 4) unless the caller is the employee themself. */
  scheme_id: string | null;
  /** Masked (last 4) unless the caller is the employee themself; HR uses the audited reveal. */
  card_number: string | null;
  card_number_masked: boolean;
  /** true when any stored ciphertext on this record could not be decrypted. */
  decrypt_failed: boolean;
  validity_from: string | null;
  validity_to: string | null;
  tier: string | null;
  dependants: DependantView[];
  dependants_count: number;
  annual_limit_minor: string | null;
  version: number | null;
  updated_at: string | Date | null;
}

type DecryptResult = { ok: true; value: string | null } | { ok: false };

export function tryDecrypt(stored: string | null | undefined): DecryptResult {
  if (stored === null || stored === undefined || stored === "") return { ok: true, value: null };
  try {
    return { ok: true, value: decryptPii(stored) };
  } catch {
    return { ok: false };
  }
}

const shown = (r: DecryptResult, inFull: boolean): string | null => {
  if (!r.ok || r.value === null) return null;
  return inFull ? r.value : (maskValue(r.value) ?? null);
};

/**
 * Build the response for one row. Card number / scheme id are shown in full
 * only when `cardInFull` (the employee themself), masked for everyone else.
 * `dependantsFullAccess` = HR write tier or the employee themself: they
 * get decrypted dependant names / dates of birth; everyone else gets the
 * relation only. `onDecryptFailure` is called (once) with no value -- for a
 * log line.
 */
export function toInsuranceView(
  row: InsuranceDbRow,
  access: { cardInFull: boolean; dependantsFullAccess: boolean },
  onDecryptFailure?: () => void,
): InsuranceView {
  const { cardInFull, dependantsFullAccess } = access;
  const card = tryDecrypt(row.card_number);
  const scheme = tryDecrypt(row.scheme_id);
  let failed = !card.ok || !scheme.ok;

  const raw = Array.isArray(row.dependants) ? (row.dependants as Array<Partial<StoredDependant>>) : [];
  const count = Array.isArray(row.dependants)
    ? raw.length
    : typeof row.dependants === "number" ? row.dependants : 0;

  const dependants: DependantView[] = raw.map((d) => {
    const relation = typeof d.relation === "string" ? d.relation : "other";
    if (!dependantsFullAccess) return { relation };
    const name = tryDecrypt(d.name ?? null);
    const dob = tryDecrypt(d.dateOfBirth ?? null);
    if (!name.ok || !dob.ok) {
      failed = true;
      return { relation, name: null, dateOfBirth: null, decrypt_failed: true };
    }
    return { relation, name: name.value, dateOfBirth: dob.value };
  });

  if (failed) onDecryptFailure?.();

  return {
    employee_id: row.employee_id,
    scheme_type: row.scheme_type,
    scheme_id: shown(scheme, cardInFull),
    card_number: shown(card, cardInFull),
    card_number_masked: failed || !cardInFull,
    decrypt_failed: failed,
    validity_from: row.validity_from,
    validity_to: row.validity_to,
    tier: row.tier,
    dependants,
    dependants_count: count,
    annual_limit_minor: row.annual_limit_minor,
    version: row.version ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** API field name -> stored column, for the audited reveal (server-side allow-list). */
export const REVEALABLE_INSURANCE_FIELDS = {
  cardNumber: "card_number",
  schemeId: "scheme_id",
} as const;
export type RevealableInsuranceField = keyof typeof REVEALABLE_INSURANCE_FIELDS;

/** publishF3Write op for the audited reveal (same mechanism as employee/pii-reveal.ts). */
export const MEDICAL_INSURANCE_REVEAL_OP = "medical_insurance_pii_reveal__0";
