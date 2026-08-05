/**
 * lead-ingestion — CRM internal-seam client.
 *
 * POSTs mapped contacts to crm-service's service-to-service lead-create seam
 * (POST /v1/crm/contacts/bulk/import/internal), authenticated with the shared
 * INTERNAL_SERVICE_SECRET (x-internal + x-service-secret + x-tenant-id) — NOT a
 * user JWT. `fetch` is injectable so the engine is testable without a live CRM.
 */
import type { MappedContact } from "./parse.js";

export type FetchLike = (input: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface CrmClientOptions {
  baseUrl?: string;
  secret?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
}

/**
 * Build a crmPost(contacts) closure bound to a tenant + source + correlationId.
 * Returns the number of contacts the CRM accepted (the batch length on 202).
 * Throws on a non-2xx / transport error so the caller records a file-level
 * failure (and never marks the file ingested).
 */
export function makeCrmPoster(
  tenantId: string,
  source: string,
  correlationId: string,
  opts: CrmClientOptions = {},
): (contacts: MappedContact[]) => Promise<number> {
  const baseUrl = opts.baseUrl ?? process.env.CRM_SERVICE_URL ?? "http://127.0.0.1:3024";
  const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
  const fetchFn: FetchLike = opts.fetchFn ?? ((globalThis.fetch as unknown) as FetchLike);
  const timeoutMs = opts.timeoutMs ?? 15000;

  return async (contacts: MappedContact[]): Promise<number> => {
    if (contacts.length === 0) return 0;
    const url = `${baseUrl.replace(/\/$/, "")}/v1/crm/contacts/bulk/import/internal`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal": "1",
        "x-service-secret": secret,
        "x-tenant-id": tenantId,
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({ tenantId, source, contacts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      throw new Error(`crm internal import failed: HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return contacts.length;
  };
}
