/**
 * The proxy may answer a list as a bare array, `{ data: [...] }` or `{ items: [...] }`
 * (the server loader accepts all three via getArrayPayload). The client refresh used
 * to accept only `{ data }`, so a bare array never updated the list
 * (GAP-ADMIN-SCHEDULED-JOBS-03). Returns null when no array is present.
 */
export function parseListPayload<T>(body: unknown): T[] | null {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object") {
    const o = body as { data?: unknown; items?: unknown };
    if (Array.isArray(o.data)) return o.data as T[];
    if (Array.isArray(o.items)) return o.items as T[];
  }
  return null;
}
