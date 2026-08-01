/**
 * Shared list-query parsing for Sprint-2 routes.
 *
 * The page size is clamped server-side (max 200) because an unbounded LIMIT is
 * the easiest way to turn a tenant's list page into a database incident.
 */
import { z } from "zod";

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ListQuery = z.infer<typeof listQuery>;

export interface ListWindow {
  page: number;
  pageSize: number;
  offset: number;
}

export function windowOf(q: ListQuery): ListWindow {
  const pageSize = Math.min(q.limit, MAX_PAGE_SIZE);
  return { page: q.page, pageSize, offset: (q.page - 1) * pageSize };
}

/** Standard list envelope: `{ data, meta: { page, pageSize, total } }`. */
export function listEnvelope<T>(rows: T[], w: ListWindow, total: number): {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
} {
  return { data: rows, meta: { page: w.page, pageSize: w.pageSize, total } };
}
