/**
 * Account lookups against `GET /v1/crm/accounts`, which can look accounts up by id
 * (`ids=`, comma-separated, at most 50) and search them by name (`search=`). Both answer in
 * ONE request however many accounts the tenant has: the callers (the onboarding pages and the
 * opportunity account picker) used to page the whole list - up to 25 requests - to find a
 * single name, and an inactive or missing account made them read it to the end.
 */
import { browserFetch } from "@/lib/api/browserClient";
import { dataOf, type ListRow } from "./pagedList";

/** crm-service caps one `?ids=` lookup at this many ids (contacts/validators.ts MAX_ACCOUNT_LOOKUP_IDS). */
export const ACCOUNT_IDS_PER_REQUEST = 50;

export interface AccountRowsResult {
  rows: ListRow[];
  /**
   * True when every request got a definitive answer. An id the server did not return is then
   * known to be inactive or missing; false means a request failed, so a missing row only
   * means "not found yet".
   */
  complete: boolean;
}

/** The named accounts among `ids`, 50 ids per request. Only active accounts of the caller's tenant come back. */
export async function fetchAccountsByIds(ids: Iterable<string>): Promise<AccountRowsResult> {
  const wanted = [...new Set(ids)].filter((id) => id !== "");
  const rows: ListRow[] = [];
  let complete = true;
  for (let i = 0; i < wanted.length; i += ACCOUNT_IDS_PER_REQUEST) {
    const chunk = wanted.slice(i, i + ACCOUNT_IDS_PER_REQUEST);
    try {
      const res = await browserFetch(`v1/crm/accounts?limit=${ACCOUNT_IDS_PER_REQUEST}&ids=${encodeURIComponent(chunk.join(","))}`);
      if (!res.ok) {
        complete = false;
        continue;
      }
      rows.push(...dataOf(await res.json()));
    } catch {
      complete = false;
    }
  }
  return { rows, complete };
}

/** Accounts whose name contains `query` (all accounts, name order, when blank), at most `limit`. Throws on a failed request. */
export async function searchAccountsByName(query: string, limit: number, signal?: AbortSignal): Promise<ListRow[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const q = query.trim();
  if (q) params.set("search", q);
  const res = await browserFetch(`v1/crm/accounts?${params.toString()}`, signal ? { signal } : {});
  if (!res.ok) throw new Error(`accounts search failed (${res.status})`);
  return dataOf(await res.json());
}
