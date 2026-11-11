/**
 * Page through a limit/offset list endpoint until it is exhausted.
 *
 * The identity user list answers at most USERS_PAGE_SIZE rows per call (a larger `limit` is a 400), so any
 * caller that needs "everyone" (a name lookup, a picker) must walk the pages instead of assuming one call.
 * A short page ends the walk. `complete` is false only when MAX_PAGES was hit with more still to come, so
 * the caller can say the list is partial instead of silently showing a truncated one.
 *
 * `fetchPage` returns that page's rows, or null when the call failed. A failure on any page fails the
 * whole walk (null): half a directory presented as the whole thing is the bug this exists to prevent.
 */
export const USERS_PAGE_SIZE = 200;
export const MAX_PAGES = 25; // 25 x 200 = 5000 users

export async function fetchAllPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[] | null>,
  pageSize: number = USERS_PAGE_SIZE,
  maxPages: number = MAX_PAGES,
): Promise<{ rows: T[]; complete: boolean } | null> {
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(pageSize, page * pageSize);
    if (batch === null) return null;
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, complete: true };
  }
  return { rows, complete: false };
}
