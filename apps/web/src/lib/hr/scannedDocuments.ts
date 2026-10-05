/**
 * Scanned documents on an employee's personnel file (GAP-ADMIN-BULK-SCAN-02, HR link target).
 *
 * Pure helpers for the HR employee profile section. hrms-service returns masked metadata only
 * (PII-masked excerpt, PII *types*); the file itself is downloaded through document-service
 * (presigned + audited) via the BFF. Download/confidence helpers are shared in @/lib/scannedDocuments.
 */
import {
  docTypeLabel, downloadFailureFor, extractDownloadUrl, formatConfidencePct, KNOWN_DOC_TYPES, scannedDocumentDownloadPath, scannedDocumentsView,
  type DownloadFailure, type ScannedDocumentsView,
} from "@/lib/scannedDocuments";

export { docTypeLabel, downloadFailureFor, extractDownloadUrl, formatConfidencePct, KNOWN_DOC_TYPES, scannedDocumentDownloadPath, scannedDocumentsView };
export type { DownloadFailure, ScannedDocumentsView };

export interface HrScannedDocument {
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
  filedAt: string | null;
}

export type ConfidenceTone = "good" | "warn" | "bad" | "mut";

/** OCR confidence badge tone: >= 90% good, >= 70% warn, below that bad; unknown is muted. */
export function confidenceTone(c: number | null | undefined): ConfidenceTone {
  if (c === null || c === undefined || !Number.isFinite(c)) return "mut";
  if (c >= 0.9) return "good";
  if (c >= 0.7) return "warn";
  return "bad";
}

/** Path (under the gateway's /api prefix) of the hrms read route. Linked documents only (server default). */
export function hrScannedDocumentsPath(employeeId: string): string {
  return `/api/v1/hrms/employees/${encodeURIComponent(employeeId)}/scanned-documents`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate/normalise the hrms-service payload. Returns null on a malformed body so the loader reports an error. */
export function mapHrScannedDocuments(payload: unknown): HrScannedDocument[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  const out: HrScannedDocument[] = [];
  for (const raw of payload.data as unknown[]) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.documentId !== "string" || typeof raw.fileName !== "string") return null;
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
      filedAt: typeof raw.filedAt === "string" ? raw.filedAt : null,
    });
  }
  return out;
}
