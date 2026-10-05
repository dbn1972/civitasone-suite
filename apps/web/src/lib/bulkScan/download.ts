/**
 * Download a filed scanned document, or fetch a page image, through document-service (presigned, audited) using the shared
 * helpers. Distinguishes a clearance denial (403 CLEARANCE_DENIED: the record is above the caller's clearance, retrying
 * cannot help) from an unavailable clearance check (503 CLEARANCE_UNAVAILABLE: retry later) and from the ordinary
 * permission / not-found / generic failures.
 */
import { downloadFailureFor, extractDownloadUrl, scannedDocumentDownloadPath, type DownloadFailure } from "@/lib/scannedDocuments";

export type DownloadVariant = "original" | "searchable_pdf" | "text" | "json";
export type RouteFailure = DownloadFailure | "clearanceDenied" | "clearanceUnavailable" | "variantUnavailable";
export type DownloadOutcome = { ok: true } | { ok: false; failure: RouteFailure };
export type PageImageOutcome = { ok: true; url: string } | { ok: false; failure: RouteFailure };

/** i18n key (under bulkScan) for each failure. */
export const FAILURE_KEYS: Record<RouteFailure, string> = {
  forbidden: "download.forbidden", notFound: "download.notFound", failed: "download.failed",
  clearanceDenied: "download.clearanceDenied", clearanceUnavailable: "download.clearanceUnavailable", variantUnavailable: "download.variantUnavailable",
};

/** Only a 503 clearance outage (or a plain transient failure) is worth retrying. */
export const isRetryableRouteFailure = (f: RouteFailure): boolean => f === "clearanceUnavailable" || f === "failed";

export async function failureFromResponse(res: { status: number; json?: () => Promise<unknown> }): Promise<RouteFailure> {
  const body: unknown = typeof res.json === "function" ? await res.json().catch(() => null) : null;
  const code = body !== null && typeof body === "object" ? (body as Record<string, unknown>).code : null;
  if (code === "CLEARANCE_DENIED") return "clearanceDenied";
  if (code === "CLEARANCE_UNAVAILABLE") return "clearanceUnavailable";
  if (code === "VARIANT_UNAVAILABLE") return "variantUnavailable";
  return downloadFailureFor(res.status);
}

export async function downloadScannedDocument(documentId: string, variant: DownloadVariant = "original", fileName = "document"): Promise<DownloadOutcome> {
  try {
    const res = await fetch(`${scannedDocumentDownloadPath(documentId)}?variant=${variant}`, { headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, failure: await failureFromResponse(res) };
    const contentType = res.headers?.get("content-type") ?? "";
    if (contentType !== "" && !contentType.includes("json")) {
      // The service streamed the file itself.
      const blobUrl = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(blobUrl);
      return { ok: true };
    }
    const url = extractDownloadUrl(await res.json().catch(() => null));
    if (!url) return { ok: false, failure: "failed" };
    window.open(url, "_blank", "noopener,noreferrer");
    return { ok: true };
  } catch {
    return { ok: false, failure: "failed" };
  }
}

/** Short-lived URL of one page image of a filed document (audited view). */
export async function fetchPageImageUrl(documentId: string, pageNumber: number): Promise<PageImageOutcome> {
  try {
    const res = await fetch(`/api/proxy/v1/documents/bulk-scan/files/${encodeURIComponent(documentId)}/pages/${pageNumber}/image`, { headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, failure: await failureFromResponse(res) };
    const url = extractDownloadUrl(await res.json().catch(() => null));
    return url ? { ok: true, url } : { ok: false, failure: "failed" };
  } catch {
    return { ok: false, failure: "failed" };
  }
}
