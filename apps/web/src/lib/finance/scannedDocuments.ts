/**
 * Scanned documents attached to a finance payment / voucher / bill (GAP-ADMIN-BULK-SCAN-02, Finance link target).
 *
 * Pure helpers shared by the finance detail pages. The finance-service read routes return masked metadata only
 * (PII-masked excerpt, PII *types*, paise as base-10 STRINGS); the file itself is downloaded through
 * document-service. Nothing here converts money to a Number.
 */

/** Shared helpers (download, confidence, empty-vs-error) live in @/lib/scannedDocuments. */
export type ScannedDocumentsKind = "payments" | "bills" | "vouchers";

export interface ScannedDocument {
  id: string;
  documentId: string;
  batchId: string;
  fileName: string;
  mimeType: string | null;
  docType: string;
  pageCount: number;
  /** 0..1 ratio (not money). */
  ocrConfidence: number | null;
  piiFlags: string[];
  textPreviewMasked: string | null;
  matchedReference: string | null;
  /** Paise as an exact base-10 string. */
  matchedAmountMinor: string | null;
  linkId: string;
  linkedBy: string;
  approvedBy: string | null;
  filedAt: string | null;
  linkedAt: string;
}

/** Path (under the gateway's /api prefix) of the read route for a record. */
export function scannedDocumentsPath(kind: ScannedDocumentsKind, id: string): string {
  return `/v1/finance/${kind}/${encodeURIComponent(id)}/scanned-documents`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate/normalise the finance-service payload. Returns null on a malformed body so the loader reports an error. */
export function mapScannedDocuments(payload: unknown): ScannedDocument[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  const out: ScannedDocument[] = [];
  for (const raw of payload.data as unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.documentId !== "string" || typeof raw.fileName !== "string") return null;
    const minor = raw.matchedAmountMinor;
    out.push({
      id: raw.id,
      documentId: raw.documentId,
      batchId: typeof raw.batchId === "string" ? raw.batchId : "",
      fileName: raw.fileName,
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : null,
      docType: typeof raw.docType === "string" ? raw.docType : "other",
      pageCount: typeof raw.pageCount === "number" ? raw.pageCount : 0,
      ocrConfidence: typeof raw.ocrConfidence === "number" ? raw.ocrConfidence : null,
      piiFlags: Array.isArray(raw.piiFlags) ? raw.piiFlags.filter((f): f is string => typeof f === "string") : [],
      textPreviewMasked: typeof raw.textPreviewMasked === "string" ? raw.textPreviewMasked : null,
      matchedReference: typeof raw.matchedReference === "string" ? raw.matchedReference : null,
      matchedAmountMinor: typeof minor === "string" && /^\d+$/.test(minor) ? minor : null,
      linkId: typeof raw.linkId === "string" ? raw.linkId : "",
      linkedBy: typeof raw.linkedBy === "string" ? raw.linkedBy : "",
      approvedBy: typeof raw.approvedBy === "string" ? raw.approvedBy : null,
      filedAt: typeof raw.filedAt === "string" ? raw.filedAt : null,
      linkedAt: typeof raw.linkedAt === "string" ? raw.linkedAt : "",
    });
  }
  return out;
}
