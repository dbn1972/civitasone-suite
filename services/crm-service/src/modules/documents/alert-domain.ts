/**
 * DM-002 — pure alert maths for the document scheduler.
 *
 * Two independent questions, both kept free of I/O so they can be unit-tested
 * exhaustively and shared by the worker scheduler and any future "check now" path:
 *   1. which subjects are MISSING a mandatory document type, and
 *   2. which current documents are EXPIRED or expiring within N days.
 */

const DAY_MS = 86_400_000;

// ── Missing mandatory ─────────────────────────────────────────────────────────

/** A subject and the set of doc-type codes it already has a current, clean doc for. */
export interface SubjectDocs {
  subjectId: string;
  /** Codes of current, non-deleted, clean documents already attached. */
  docTypeCodes: string[];
}

export interface MissingMandatory {
  subjectType: string;
  subjectId: string;
  docTypeCode: string;
}

/**
 * For one subject_type, every (subject, mandatoryCode) pair where the subject has
 * no current document of that type. `mandatoryCodes` is the enabled+mandatory
 * document_types for this subject_type; `subjects` enumerates the tenant's rows.
 */
export function findMissingMandatory(
  subjectType: string,
  mandatoryCodes: string[],
  subjects: SubjectDocs[],
): MissingMandatory[] {
  const out: MissingMandatory[] = [];
  const codes = [...new Set(mandatoryCodes)];
  if (codes.length === 0) return out;
  for (const s of subjects) {
    const have = new Set(s.docTypeCodes);
    for (const code of codes) {
      if (!have.has(code)) out.push({ subjectType, subjectId: s.subjectId, docTypeCode: code });
    }
  }
  return out;
}

// ── Expiring / expired ─────────────────────────────────────────────────────────

export interface ExpiringDocLike {
  documentId: string;
  subjectType: string;
  subjectId: string;
  docTypeCode: string | null;
  /** DATE (YYYY-MM-DD) or Date; null rows are ignored. */
  expiryDate: string | Date | null;
}

export interface ExpiringDoc {
  documentId: string;
  subjectType: string;
  subjectId: string;
  docTypeCode: string | null;
  expiryDate: string;
  /** Whole days until expiry; negative when already expired. */
  daysUntilExpiry: number;
  expired: boolean;
}

function toExpiryDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  // A DATE is a whole day; treat it as end-of-day UTC so a document is not "expired"
  // the instant its expiry date begins (coarse by design, matching task escalation).
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const d = new Date(`${iso}T23:59:59Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * All documents that are already expired OR expire within `withinDays` of `now`.
 * `withinDays` must be >= 0; a document exactly `withinDays` out is included.
 */
export function findExpiringDocuments(
  docs: ExpiringDocLike[],
  now: Date,
  withinDays: number,
): ExpiringDoc[] {
  const out: ExpiringDoc[] = [];
  const horizon = Number.isFinite(withinDays) && withinDays >= 0 ? withinDays : 0;
  for (const d of docs) {
    const exp = toExpiryDate(d.expiryDate);
    if (!exp) continue;
    const daysUntilExpiry = Math.floor((exp.getTime() - now.getTime()) / DAY_MS);
    if (daysUntilExpiry <= horizon) {
      out.push({
        documentId: d.documentId,
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        docTypeCode: d.docTypeCode,
        expiryDate: exp.toISOString().slice(0, 10),
        daysUntilExpiry,
        expired: daysUntilExpiry < 0,
      });
    }
  }
  return out;
}
