/**
 * Shared helpers for the "Scanned documents" sections on the Finance, HR and eOffice detail pages
 * (GAP-ADMIN-BULK-SCAN-02). Module-neutral: nothing here knows about a specific link target.
 * The file itself is always downloaded through document-service (presigned + audited) via the BFF.
 */

export type ScannedDocumentsView = "error" | "empty" | "ready";

/**
 * Empty vs error vs ready. A failed load is NEVER "empty": the caller passes the loader's `source` so an API
 * failure can not masquerade as "no attachments" (empty-vs-error rule).
 */
export function scannedDocumentsView(result: { source: string; data: readonly unknown[] }): ScannedDocumentsView {
  if (result.source === "error") return "error";
  return result.data.length === 0 ? "empty" : "ready";
}

/** BFF path the browser calls to download the file (document-service owns the file, presigned + audited). */
export function scannedDocumentDownloadPath(documentId: string): string {
  return `/api/proxy/v1/documents/bulk-scan/files/${encodeURIComponent(documentId)}/download`;
}

/** OCR confidence ratio -> whole percent string ("91%"), "—" when unknown. */
export function formatConfidencePct(c: number | null | undefined): string {
  if (c === null || c === undefined || !Number.isFinite(c)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, c)) * 100)}%`;
}

/** Pull a download URL out of the document-service response; only https:// (or a same-origin path) is accepted. */
export function extractDownloadUrl(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const inner = typeof p.data === "object" && p.data !== null ? (p.data as Record<string, unknown>) : {};
  for (const v of [p.downloadUrl, inner.downloadUrl, p.url, inner.url]) {
    if (typeof v === "string" && (/^https:\/\//i.test(v) || /^\/(?!\/)/.test(v))) return v;
  }
  return null;
}

export type DownloadFailure = "forbidden" | "notFound" | "failed";

export function downloadFailureFor(status: number): DownloadFailure {
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  return "failed";
}

/** Doc types with an i18n label (scannedDocumentLabels.docType_<type>); anything else is humanised. */
export const KNOWN_DOC_TYPES = [
  "service_book", "pay_slip", "bill_voucher", "sanction_order", "office_order",
  "letter", "id_proof", "certificate", "other",
] as const;

function humanise(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "—";
}

/** Human-readable doc type: the i18n key under scannedDocumentLabels when known, else a title-cased fallback ("transfer_order" -> "Transfer order"). */
export function docTypeLabel(docType: string): { key: string } | { text: string } {
  if ((KNOWN_DOC_TYPES as readonly string[]).includes(docType)) return { key: `docType_${docType}` };
  return { text: humanise(docType) };
}

/** The PII types the bulk-scan engine reports (bulkScan settings PII_TYPES). */
export const KNOWN_PII_TYPES = ["aadhaar", "pan", "bank_account", "phone", "email"] as const;

/** Human-readable PII type: the i18n key under scannedDocumentLabels when known, else a humanised fallback. */
export function piiTypeLabel(piiType: string): { key: string } | { text: string } {
  if ((KNOWN_PII_TYPES as readonly string[]).includes(piiType)) return { key: `pii_${piiType}` };
  return { text: humanise(piiType) };
}
