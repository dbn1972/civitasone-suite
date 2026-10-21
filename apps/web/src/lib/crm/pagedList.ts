/**
 * Page through a crm-service list endpoint (`?limit=&offset=`), because the list
 * routes cap a page (GET /v1/crm/accounts: 200; deals: 500) and reject a larger
 * `limit` with a 400. Asking for one oversized page made the whole lookup fail
 * silently (GAP-CRM-ONBOARDING-01 / -DETAIL-01: the accounts lookup asked for 500 and
 * so never resolved a single account name), and a single capped page silently missed
 * every record past it. This helper keeps asking for the next page until the caller
 * has what it needs, the list is exhausted, or a safety cap on pages is reached.
 */
import { browserFetch } from "@/lib/api/browserClient";

/** crm-service caps GET /v1/crm/accounts at 200 rows per page (contacts/validators.ts listContactsQuery). */
export const CRM_LIST_PAGE_SIZE = 200;
/** Safety cap: at most this many pages per lookup (200 x 25 = 5,000 rows). */
export const CRM_LIST_MAX_PAGES = 25;

export type ListRow = Record<string, unknown>;

export interface PagedListResult {
  rows: ListRow[];
  /** True when the whole list was read, or `done` was satisfied; false when a page failed or the page cap was hit. */
  complete: boolean;
  /** False only when not even the first page could be read. */
  ok: boolean;
}

export interface PagedListOptions {
  /** Endpoint path without a query string, e.g. "v1/crm/accounts". */
  path: string;
  pageSize?: number;
  maxPages?: number;
  /** Stop as soon as the rows read so far are enough (e.g. every wanted id was found). */
  done?: (rows: ListRow[]) => boolean;
  signal?: AbortSignal;
}

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

/** Tenant-wide total when the envelope carries one (`meta.total` or `pagination.total`). */
function totalOf(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const k of ["meta", "pagination"]) {
    const v = b[k];
    if (v && typeof v === "object") {
      const total = (v as Record<string, unknown>).total;
      if (typeof total === "number" && Number.isFinite(total)) return total;
    }
  }
  return undefined;
}

export async function fetchAllPages(opts: PagedListOptions): Promise<PagedListResult> {
  const pageSize = opts.pageSize ?? CRM_LIST_PAGE_SIZE;
  const maxPages = opts.maxPages ?? CRM_LIST_MAX_PAGES;
  const rows: ListRow[] = [];
  for (let page = 0; page < maxPages; page++) {
    let body: unknown;
    try {
      const res = await browserFetch(`${opts.path}?limit=${pageSize}&offset=${rows.length}`, opts.signal ? { signal: opts.signal } : {});
      if (!res.ok) return { rows, complete: false, ok: page > 0 };
      body = await res.json();
    } catch {
      return { rows, complete: false, ok: page > 0 };
    }
    const batch = dataOf(body);
    rows.push(...batch);
    if (opts.done?.(rows)) return { rows, complete: true, ok: true };
    const total = totalOf(body);
    if (batch.length < pageSize || (total !== undefined && rows.length >= total)) return { rows, complete: true, ok: true };
  }
  return { rows, complete: false, ok: true };
}
