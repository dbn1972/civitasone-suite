/**
 * Helpers for reading rows out of a crm-service list endpoint: the row extraction every CRM
 * list response shares, and the `?ids=` lookup (at most 50 ids per request) that names a
 * page of records without paging the whole list.
 */
import { browserFetch } from "@/lib/api/browserClient";

export type ListRow = Record<string, unknown>;

/** The rows of a list response (`[...]`, `{ data: [...] }` or `{ items: [...] }`). */
export function dataOf(body: unknown): ListRow[] {
  if (Array.isArray(body)) return body.filter((r): r is ListRow => !!r && typeof r === "object");
  if (body && typeof body === "object") {
    for (const k of ["data", "items"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v.filter((r): r is ListRow => !!r && typeof r === "object");
    }
  }
  return [];
}

/** crm-service caps one `?ids=` lookup at 50 ids (GET /v1/crm/accounts and GET /v1/crm/deals). */
export const IDS_PER_REQUEST = 50;

export interface RowsByIdsResult {
  rows: ListRow[];
  /**
   * True when every request got a definitive answer. An id the server did not return is then
   * known to be inactive, deleted or missing; false means a request failed, so a missing row
   * only means "not found yet".
   */
  complete: boolean;
}

/**
 * The rows named by `ids` from a list endpoint that supports `?ids=` (comma-separated, at most
 * 50), one request per 50 ids however long the list is. A row that is not live (inactive,
 * deleted) or belongs to another tenant is simply absent from the answer, so a missing id never
 * forces the list to be paged to the end.
 */
export async function fetchRowsByIds(path: string, ids: Iterable<string>): Promise<RowsByIdsResult> {
  const wanted = [...new Set(ids)].filter((id) => id !== "");
  const rows: ListRow[] = [];
  let complete = true;
  for (let i = 0; i < wanted.length; i += IDS_PER_REQUEST) {
    const chunk = wanted.slice(i, i + IDS_PER_REQUEST);
    try {
      const res = await browserFetch(`${path}?limit=${IDS_PER_REQUEST}&ids=${encodeURIComponent(chunk.join(","))}`);
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
