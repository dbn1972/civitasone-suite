/**
 * F2 — client helper for the server-side audited CSV exports.
 *
 * The server (crm-service export-routes) is the authority: it applies the active
 * filters, masks PII by role, enforces the admin gate, and records a bulk-export
 * audit event carrying the operator's stated `purpose`. This helper calls that
 * endpoint through the BFF proxy and streams the returned CSV to a file download
 * — replacing the old client-side DataTable Blob, which could never be audited.
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";

/** A download that was triggered, with the row count the server reported (if any). */
export interface ExportResult {
  filename: string;
}

/**
 * Call an audited export endpoint with a `purpose` and the active filters, then
 * download the CSV the server returns. Throws a user-facing message on failure
 * (403 for a non-admin, 400 for a too-short purpose) so the caller can surface it.
 */
export async function downloadServerCsv(
  endpointPath: string,
  purpose: string,
  filters: Record<string, string | undefined> = {},
  filenameBase = "export",
): Promise<ExportResult> {
  const params = new URLSearchParams();
  params.set("purpose", purpose);
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const res = await browserFetch(`${endpointPath}?${params.toString()}`, { method: "GET" });
  if (!res.ok) throw new Error(await errorMessageFromResponse(res, undefined, "export"));

  const csv = await res.text();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${filenameBase}-${stamp}.csv`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { filename };
}
