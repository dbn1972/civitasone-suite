/**
 * Interview recording / transcript with consent + retention (R-RA-0152) — pure.
 *
 * A recording or transcript may only be registered with the candidate's explicit
 * CONSENT. Each artefact carries a RETENTION deadline (retention_until); past it,
 * a purge job soft-deletes the record and the object store deletes the bytes.
 * The media itself lives behind an object-storage SEAM — only its key is stored
 * here; we never keep the bytes in Postgres. No I/O in this module.
 */

export const RECORDING_KINDS = ["recording", "transcript"] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];

export const RECORDING_STATUSES = ["active", "deleted"] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** Default retention window when the caller does not specify one (days). */
export const DEFAULT_RETENTION_DAYS = 180;
/** Guardrails on a caller-supplied retention window. */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650; // 10 years

export interface RecordingInput {
  kind: string;
  storageKey?: string | undefined;
  consentGiven?: boolean | undefined;
  consentReference?: string | undefined;
  retentionDays?: number | undefined;
}

/**
 * An object key is safe when it cannot escape its namespace: no path traversal
 * (`..`), no empty segments (`//`), no leading slash, no backslashes, and no
 * control characters. `startsWith(prefix)` alone is NOT sufficient — a key like
 * `interviews/<id>/recordings/../../<other>/x` starts with the prefix yet
 * resolves outside it.
 */
export function isSafeStorageKey(key: string): boolean {
  if (key.length === 0) return false;
  if (key.startsWith("/") || key.includes("..") || key.includes("//") || key.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(key)) return false;
  return true;
}

/**
 * Validate a recording registration. Consent is MANDATORY (fail closed) and must
 * carry a reference (auditable proof pointer — a signed-form id, e-consent token,
 * etc.), not just a bare flag. The storage key must be traversal-safe. Returns
 * errors (empty = ok).
 */
export function validateRecording(input: RecordingInput): string[] {
  const errors: string[] = [];
  if (!(RECORDING_KINDS as readonly string[]).includes(input.kind)) {
    errors.push(`kind must be one of: ${RECORDING_KINDS.join(", ")}`);
  }
  if (!input.storageKey || input.storageKey.trim().length === 0) {
    errors.push("storageKey is required");
  } else if (!isSafeStorageKey(input.storageKey)) {
    errors.push("storageKey contains an unsafe path (no '..', '//', leading '/', or backslashes)");
  }
  if (input.consentGiven !== true) errors.push("candidate consent is required to store a recording or transcript");
  if (!input.consentReference || input.consentReference.trim().length === 0) {
    errors.push("a consentReference (proof of the candidate's consent) is required");
  }
  if (input.retentionDays !== undefined) {
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < MIN_RETENTION_DAYS || input.retentionDays > MAX_RETENTION_DAYS) {
      errors.push(`retentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`);
    }
  }
  return errors;
}

/** The object-store key namespace for an interview's media (IDOR guard). */
export function recordingKeyPrefix(interviewId: string): string {
  return `interviews/${interviewId}/recordings/`;
}

/** retention_until = now + days, as a YYYY-MM-DD date string (UTC). */
export function computeRetentionUntil(nowMs: number, days: number = DEFAULT_RETENTION_DAYS): string {
  const d = new Date(nowMs + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** True when a retention deadline (YYYY-MM-DD) is on/before "now" (i.e. purgeable). */
export function isExpired(retentionUntil: string, nowMs: number): boolean {
  const end = Date.parse(`${retentionUntil}T23:59:59Z`);
  return Number.isFinite(end) && end <= nowMs;
}
