/**
 * Scan-link (Finance target) — read side. Tenant-scoped, RLS-scoped, bigint-safe: every money field leaves this
 * module as a base-10 string (paise), never a JS number.
 *
 * NOTE (cache): attachments are deliberately read straight from Postgres (scopedRead) rather than through
 * cache.getOrLoad. They are written by an async consumer in another process, which has no cache invalidation
 * hook for the read key, and a stale "no attachments yet" after a link lands would hide evidence from a finance
 * reviewer. The list is bounded (100) and index-backed (tenant, kind, target, state).
 */
import {
  lookupCandidateSchema, type LookupCandidate,
} from "@civitasone/scan-link";
import { normaliseReference, parseMinor, type ScanTargetKind } from "./match.js";
import * as repo from "./repo.js";
import type { ScannedDocumentRow } from "./schema.js";

export interface ScannedDocumentDto {
  id: string;
  documentId: string;
  batchId: string;
  fileName: string;
  mimeType: string | null;
  docType: string;
  pageCount: number;
  ocrConfidence: number | null;
  piiFlags: string[];
  textPreviewMasked: string | null;
  matchedReference: string | null;
  matchedAmountMinor: string | null;
  linkId: string;
  linkedBy: string;
  approvedBy: string | null;
  filedAt: string | null;
  linkedAt: string;
}

export function toDto(r: ScannedDocumentRow): ScannedDocumentDto {
  return {
    id: r.id, documentId: r.documentId, batchId: r.batchId, fileName: r.fileName, mimeType: r.mimeType,
    docType: r.docType, pageCount: r.pageCount,
    ocrConfidence: r.ocrConfidence === null ? null : Number(r.ocrConfidence), // a 0..1 ratio, not money
    piiFlags: r.piiFlags, textPreviewMasked: r.textPreviewMasked, matchedReference: r.matchedReference,
    matchedAmountMinor: r.matchedAmountMinor === null ? null : r.matchedAmountMinor.toString(),
    linkId: r.linkId, linkedBy: r.linkedBy, approvedBy: r.approvedBy,
    filedAt: r.filedAt ? r.filedAt.toISOString() : null, linkedAt: r.createdAt.toISOString(),
  };
}

/** null when the target does not exist in the tenant (caller maps to 404). */
export async function listScannedDocuments(tenantId: string, kind: ScanTargetKind, id: string): Promise<ScannedDocumentDto[] | null> {
  if (!(await repo.targetExists(tenantId, kind, id))) return null;
  return (await repo.listForTarget(tenantId, kind, id)).map(toDto);
}

const LOOKUP_MAX = 10;
const ALL_KINDS: ScanTargetKind[] = ["finance_payment", "finance_voucher", "finance_bill"];

/**
 * Exact reference + exact amount => confidence 1.0.
 * Reference-only (amount absent or different) => 0.5, carrying requestedAmountMinor + the record amount +
 * amountMatches=false so the reviewer sees the mismatch. At most 10, exact first. Tenant scoped.
 */
export async function lookup(
  tenantId: string,
  p: { reference: string; amountMinor?: string; kind?: ScanTargetKind },
): Promise<LookupCandidate[]> {
  const refNorm = normaliseReference(p.reference);
  if (refNorm === "") return [];
  const requested = p.amountMinor === undefined ? null : parseMinor(p.amountMinor);
  const kinds = p.kind ? [p.kind] : ALL_KINDS;
  const out: LookupCandidate[] = [];
  for (const kind of kinds) {
    for (const row of await repo.lookupByReference(tenantId, kind, refNorm, LOOKUP_MAX)) {
      const primary = row.amountsMinor[0] ?? 0n;
      const exact = requested !== null && row.amountsMinor.some((a) => a === requested);
      out.push(lookupCandidateSchema.parse({
        target: kind, targetId: row.id, label: row.label.slice(0, 300), reference: row.reference,
        amountMinor: (exact && requested !== null ? requested : primary).toString(),
        confidence: exact ? 1 : 0.5,
        requestedAmountMinor: requested === null ? null : requested.toString(),
        amountMatches: requested === null ? null : exact,
      }));
    }
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, LOOKUP_MAX);
}
