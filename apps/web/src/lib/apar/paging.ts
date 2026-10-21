/**
 * GAP-HR-APAR-06: limit/offset paging helpers for the APAR list page.
 *
 * The page keeps its position in a 1-based `?page=` search param (so a
 * filtered, searched, paged view is a shareable URL) and turns it into the
 * `limit`/`offset` GET /v1/hrms/apar accepts. Pure functions, no I/O.
 */

/** Records per page on the APAR list. */
export const APAR_PAGE_SIZE = 20;

/** Upper bound on `?page=`, so a hostile value cannot ask for an absurd offset. */
const MAX_PAGE = 10_000;

/** Parses a raw `?page=` value to a 1-based page number; anything invalid is page 1. */
export function parsePage(raw: unknown): number {
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function offsetForPage(page: number, pageSize: number = APAR_PAGE_SIZE): number {
  return (Math.max(1, page) - 1) * pageSize;
}

export interface PageWindow {
  /** 1-based index of the first row shown, 0 when there are none. */
  from: number;
  /** 1-based index of the last row shown. */
  to: number;
  prevPage: number | null;
  nextPage: number | null;
}

/** The "Showing from-to of total" window and the neighbouring pages (null at either end). */
export function pageWindow(total: number, offset: number, shown: number, pageSize: number = APAR_PAGE_SIZE): PageWindow {
  const page = Math.floor(offset / pageSize) + 1;
  return {
    from: shown > 0 ? offset + 1 : 0,
    to: offset + shown,
    prevPage: page > 1 ? page - 1 : null,
    nextPage: offset + pageSize < total ? page + 1 : null,
  };
}
