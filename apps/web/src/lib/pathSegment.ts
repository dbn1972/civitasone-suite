/**
 * Safe interpolation of a route param into a backend path (GAP-ADMIN-TENANTS-
 * DETAIL-03). Loaders build paths from `[id]` params; without this, an id like
 * `..%2Fusers` (decoded to `../users` by the router) would address a different
 * admin endpoint from the server-side fetch.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: string): boolean {
  return UUID.test(id);
}

export function pathSeg(id: string): string {
  return encodeURIComponent(id);
}
