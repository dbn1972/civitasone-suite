/**
 * Shared list pagination for visitor-service list endpoints (CLOS3-S6-15/16).
 *
 * Lists used to be unbounded. They are now offset-paged with an explicit,
 * discoverable cap: `limit` (default {@link DEFAULT_LIST_LIMIT}, max
 * {@link MAX_LIST_LIMIT}) and `offset`. Responses carry `meta.hasMore` so a
 * client never mistakes a truncated page for the whole set.
 */
import { z } from "zod";

export const DEFAULT_LIST_LIMIT = 500;
export const MAX_LIST_LIMIT = 1000;

export const pageQueryShape = {
  limit: z.coerce.number().int("limit must be an integer").min(1, "limit must be at least 1").max(MAX_LIST_LIMIT, `limit must be ${MAX_LIST_LIMIT} or fewer`).default(DEFAULT_LIST_LIMIT),
  offset: z.coerce.number().int("offset must be an integer").min(0, "offset must be 0 or greater").default(0),
};

export interface PageOpts {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface Paged<T> {
  rows: T[];
  hasMore: boolean;
}

/** Normalise caller-supplied paging into a safe [1, MAX] limit and a non-negative offset. */
export function resolvePage(opts: PageOpts = {}): { limit: number; offset: number } {
  const rawLimit = Number.isFinite(opts.limit) ? Math.floor(opts.limit as number) : DEFAULT_LIST_LIMIT;
  const rawOffset = Number.isFinite(opts.offset) ? Math.floor(opts.offset as number) : 0;
  return { limit: Math.min(Math.max(rawLimit, 1), MAX_LIST_LIMIT), offset: Math.max(rawOffset, 0) };
}

/** Given rows fetched with `limit + 1`, split off the extra sentinel row. */
export function splitPage<T>(fetched: T[], limit: number): Paged<T> {
  return fetched.length > limit ? { rows: fetched.slice(0, limit), hasMore: true } : { rows: fetched, hasMore: false };
}
