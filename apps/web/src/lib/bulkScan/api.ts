/**
 * Browser-side client for /v1/documents/bulk-scan through the BFF proxy (cookie auth is added server-side).
 * Writes are asynchronous: the server answers 202 {id,status:"accepted",correlationId} and applies the change in a worker,
 * so callers refetch (after a short delay) rather than assume the change landed.
 */
import { referenceFromHeaders } from "@/lib/errorCatalogue";

export const BULK_SCAN_API = "/api/proxy/v1/documents/bulk-scan";

export type ApiResult =
  | { ok: true; status: number; json: unknown }
  /** `reference` is the support reference (correlation id) the failed response carried; shown only as a quiet secondary line. */
  | { ok: false; status: number; code: string | null; message: string | null; reference: string | null };

export type FailedResult = Extract<ApiResult, { ok: false }>;

export type Method = "GET" | "POST" | "PUT" | "DELETE";

export async function bsRequest(path: string, init: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult> {
  try {
    const res = await fetch(`${BULK_SCAN_API}${path}`, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: "no-store",
      ...(init.signal ? { signal: init.signal } : {}),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const r = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
      return { ok: false, status: res.status, code: typeof r.code === "string" ? r.code : null, message: typeof r.message === "string" ? r.message : null, reference: referenceFromHeaders(res.headers) };
    }
    return { ok: true, status: res.status, json };
  } catch {
    return { ok: false, status: 0, code: null, message: null, reference: null };
  }
}

/** Build `?a=1&b=2`, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && `${v}` !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Optimistic-concurrency conflict from review edit/approve/reject (409 STALE). */
export function isStale(r: ApiResult): boolean {
  return !r.ok && r.status === 409 && /STALE|VERSION/i.test(r.code ?? "");
}

/**
 * Codes with bulk-scan specific, catalogued copy (en/hi under bulkScan.apiError.*). Generic situations (validation, not found,
 * permission, session, server, network) are NOT listed here: they take the app standard (lib/errorCatalogue.ts) so the copy and
 * the support reference line never drift from the rest of the app.
 */
const CODE_KEYS = new Set([
  "MAKER_CHECKER_VIOLATION", "SUPER_ADMIN_REQUIRED", "REASON_REQUIRED", "NOT_PENDING", "NOT_RETRYABLE", "NOT_SKIPPABLE", "BATCH_CANCELLED",
  "ALREADY_CANCELLED", "FILE_TOO_LARGE", "TOO_MANY_FILES", "BATCH_TOO_LARGE", "LINK_TARGET_NOT_ALLOWED", "UNKNOWN_PROFILE",
  "UNKNOWN_DOC_TYPE", "STORAGE_UNAVAILABLE", "STALE", "CLEARANCE_DENIED", "CLEARANCE_UNAVAILABLE", "NOT_REVIEWABLE", "LINK_ALREADY_ACTIVE",
  "NOT_LINKED", "INVALID_LINK_TARGET", "INVALID_FIELD_VALUE", "VARIANT_UNAVAILABLE", "NOT_PENDING_UPLOAD",
]);

/**
 * i18n key (under bulkScan) of the code-specific copy for a failed call, or null when the app-standard message applies
 * (see `useBulkScanError`). Never the backend's raw message.
 */
export function specificErrorKey(r: FailedResult): string | null {
  if (isStale(r)) return "apiError.STALE";
  if (r.code && CODE_KEYS.has(r.code)) return `apiError.${r.code}`;
  return null;
}

/** How long to wait before re-reading after the server answered 202 (queued, not yet applied). */
export const QUEUED_RELOAD_DELAY_MS = 1500;

/** The retry-able failures: transient server/network trouble and an unavailable clearance check (503), never a permission denial. */
export function isRetryableFailure(r: FailedResult): boolean {
  return r.status === 0 || r.status >= 500 || r.code === "CLEARANCE_UNAVAILABLE";
}
