/**
 * Data Quality & Duplicate Management client (BRD §7.2, DQ-001..DQ-004).
 *
 * All calls route through the BFF proxy via browserFetch (httpOnly session).
 * On failure the loaders return { source: "error" } so screens can render "—"
 * + DataSourceBadge instead of fabricating a zero as fact.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

export type DqEntity = "contacts" | "leads" | "accounts";
export type DqFilter = "missing" | "invalid" | "stale";
export type DqSource = "api" | "error";

/** Candidate fields sent to the duplicate-check endpoint (DQ-001). */
export interface DuplicateCheckInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  gstin?: string;
  pan?: string;
}

/** One ranked potential duplicate returned by duplicate-check. */
export interface DuplicateCandidate {
  id: string;
  matchedFields: string[];
  score: number;
  /** Optional display fields the backend may include for preview. */
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export type DedupField = "email" | "phone" | "gstin" | "pan" | "name" | "company";
export type DedupMatchType = "exact" | "fuzzy";

export interface DedupRule {
  field: DedupField;
  matchType: DedupMatchType;
  weight: number;
  threshold: number;
  enabled: boolean;
}

export interface DqBucket {
  label: string;
  count: number;
}

export interface DqRecord {
  id: string;
  score: number;
  issues: string[];
}

export interface DataQualityReport {
  distribution: DqBucket[];
  counts: { missing: number; invalid: number; stale: number };
  records: DqRecord[];
}

export interface LoaderResult<T> {
  data: T;
  source: DqSource;
}

/** Format-validation error codes surfaced inline on create/update (DQ-003). */
export const FIELD_ERROR_CODES = {
  INVALID_MOBILE: "phone",
  INVALID_PINCODE: "pincode",
  INVALID_GSTIN: "gstin",
  INVALID_PAN: "pan",
} as const;

export type FieldErrorCode = keyof typeof FIELD_ERROR_CODES;
export type ValidatedField = (typeof FIELD_ERROR_CODES)[FieldErrorCode];

export interface FieldError {
  field: ValidatedField;
  code: FieldErrorCode;
  message: string;
}

/**
 * Turn a server error string ("INVALID_GSTIN: bad checksum") or a parsed
 * {code,message} body into a per-field error, or null when it is not a
 * recognised format-validation code (caller shows it as a banner instead).
 */
export function parseFieldError(input: string | { code?: string; message?: string }): FieldError | null {
  let code: string | undefined;
  let message: string | undefined;
  if (typeof input === "string") {
    const idx = input.indexOf(":");
    code = (idx >= 0 ? input.slice(0, idx) : input).trim();
    message = (idx >= 0 ? input.slice(idx + 1) : "").trim();
  } else {
    code = input.code?.trim();
    message = input.message?.trim();
  }
  if (!code || !(code in FIELD_ERROR_CODES)) return null;
  const typedCode = code as FieldErrorCode;
  return {
    field: FIELD_ERROR_CODES[typedCode],
    code: typedCode,
    message: message && message.length > 0 ? message : defaultFieldMessage(typedCode),
  };
}

function defaultFieldMessage(code: FieldErrorCode): string {
  switch (code) {
    case "INVALID_MOBILE":
      return "Enter a valid 10-digit Indian mobile number.";
    case "INVALID_PINCODE":
      return "Enter a valid 6-digit PIN code.";
    case "INVALID_GSTIN":
      return "Enter a valid 15-character GSTIN.";
    case "INVALID_PAN":
      return "Enter a valid 10-character PAN.";
  }
}

/** Normalise duplicate-check responses whether bare array or { candidates }. */
export function normaliseCandidates(raw: unknown): DuplicateCandidate[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { candidates?: unknown }).candidates)
      ? (raw as { candidates: unknown[] }).candidates
      : [];
  const out: DuplicateCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string") continue;
    out.push({
      id: r.id,
      matchedFields: Array.isArray(r.matchedFields) ? r.matchedFields.map(String) : [],
      score: typeof r.score === "number" ? r.score : Number(r.score) || 0,
      name: typeof r.name === "string" ? r.name : undefined,
      email: typeof r.email === "string" ? r.email : undefined,
      phone: typeof r.phone === "string" ? r.phone : undefined,
      company: typeof r.company === "string" ? r.company : undefined,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** DQ-001: find potential duplicates before saving a new contact. */
export async function duplicateCheck(input: DuplicateCheckInput): Promise<DuplicateCandidate[]> {
  const res = await browserFetch("v1/crm/contacts/duplicate-check", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
  return normaliseCandidates(await res.json());
}

/** Parse the dedup-rules payload (bare array or { rules }). */
export function normaliseRules(raw: unknown): DedupRule[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { rules?: unknown }).rules)
      ? (raw as { rules: unknown[] }).rules
      : [];
  const out: DedupRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.field !== "string") continue;
    out.push({
      field: r.field as DedupField,
      matchType: r.matchType === "fuzzy" ? "fuzzy" : "exact",
      weight: typeof r.weight === "number" ? r.weight : Number(r.weight) || 0,
      threshold: typeof r.threshold === "number" ? r.threshold : Number(r.threshold) || 0,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

export async function getDedupRules(): Promise<LoaderResult<DedupRule[]>> {
  try {
    const res = await browserFetch("v1/crm/dedup-rules");
    if (!res.ok) return { data: [], source: "error" };
    return { data: normaliseRules(await res.json()), source: "api" };
  } catch {
    return { data: [], source: "error" };
  }
}

export async function saveDedupRules(rules: DedupRule[]): Promise<void> {
  const res = await browserFetch("v1/crm/dedup-rules", {
    method: "PUT",
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

/** DQ-002: merge is async (202). Body is { primaryId, duplicateId }. */
export async function mergeEntities(
  entity: DqEntity,
  primaryId: string,
  duplicateId: string,
): Promise<void> {
  const res = await browserFetch(`v1/crm/${entity}/merge`, {
    method: "POST",
    body: JSON.stringify({ primaryId, duplicateId }),
  });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res));
}

export function normaliseReport(raw: unknown): DataQualityReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const counts = (r.counts && typeof r.counts === "object" ? r.counts : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
  return {
    distribution: Array.isArray(r.distribution)
      ? r.distribution
          .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
          .map((b) => ({ label: String(b.label ?? ""), count: num(b.count) }))
      : [],
    counts: { missing: num(counts.missing), invalid: num(counts.invalid), stale: num(counts.stale) },
    records: Array.isArray(r.records)
      ? r.records
          .filter((rec): rec is Record<string, unknown> => !!rec && typeof rec === "object")
          .map((rec) => ({
            id: String(rec.id ?? ""),
            score: num(rec.score),
            issues: Array.isArray(rec.issues) ? rec.issues.map(String) : [],
          }))
      : [],
  };
}

export async function getDataQuality(
  entity: DqEntity,
  filter: DqFilter,
): Promise<LoaderResult<DataQualityReport>> {
  const empty: DataQualityReport = {
    distribution: [],
    counts: { missing: 0, invalid: 0, stale: 0 },
    records: [],
  };
  try {
    const res = await browserFetch(`v1/crm/data-quality?entity=${entity}&filter=${filter}`);
    if (!res.ok) return { data: empty, source: "error" };
    return { data: normaliseReport(await res.json()), source: "api" };
  } catch {
    return { data: empty, source: "error" };
  }
}
