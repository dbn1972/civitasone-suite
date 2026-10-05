/**
 * Scanned documents filed on an eOffice file (GAP-ADMIN-BULK-SCAN-02, eOffice link target).
 *
 * Pure helpers for the eFile detail page. estab-service returns masked metadata only
 * (PII-masked excerpt, PII *types*); the file itself is downloaded through document-service
 * (presigned + audited) via the BFF. Download/confidence helpers are shared in @/lib/scannedDocuments.
 */
import {
  downloadFailureFor, extractDownloadUrl, formatConfidencePct, scannedDocumentDownloadPath, scannedDocumentsView,
  type DownloadFailure, type ScannedDocumentsView,
} from "@/lib/scannedDocuments";

export { downloadFailureFor, extractDownloadUrl, formatConfidencePct, scannedDocumentDownloadPath, scannedDocumentsView };
export type { DownloadFailure, ScannedDocumentsView };

export interface EstabScannedDocument {
  id: string;
  linkId: string;
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
  linkedBy: string;
  approvedBy: string | null;
  filedAt: string | null;
}

/** Path (under the gateway's /api prefix) of the estab read route. Linked documents only (server default). */
export function estabScannedDocumentsPath(fileId: string): string {
  return `/api/v1/estab/files/${encodeURIComponent(fileId)}/scanned-documents`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate/normalise the estab-service payload. Returns null on a malformed body so the loader reports an error. */
export function mapEstabScannedDocuments(payload: unknown): EstabScannedDocument[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  const out: EstabScannedDocument[] = [];
  for (const raw of payload.data as unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.documentId !== "string" || typeof raw.fileName !== "string") return null;
    out.push({
      id: raw.id,
      linkId: typeof raw.linkId === "string" ? raw.linkId : "",
      documentId: raw.documentId,
      batchId: typeof raw.batchId === "string" ? raw.batchId : "",
      fileName: raw.fileName,
      mimeType: typeof raw.mimeType === "string" ? raw.mimeType : null,
      docType: typeof raw.docType === "string" ? raw.docType : "other",
      pageCount: typeof raw.pageCount === "number" ? raw.pageCount : 0,
      ocrConfidence: typeof raw.ocrConfidence === "number" ? raw.ocrConfidence : null,
      piiFlags: Array.isArray(raw.piiFlags) ? raw.piiFlags.filter((f): f is string => typeof f === "string") : [],
      textPreviewMasked: typeof raw.textPreviewMasked === "string" ? raw.textPreviewMasked : null,
      linkedBy: typeof raw.linkedBy === "string" ? raw.linkedBy : "",
      approvedBy: typeof raw.approvedBy === "string" ? raw.approvedBy : null,
      filedAt: typeof raw.filedAt === "string" ? raw.filedAt : null,
    });
  }
  return out;
}
