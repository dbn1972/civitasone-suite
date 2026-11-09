/**
 * UAT b23 (P1/M4): one place that decides how the server Data Cache (Next fetch cache) is
 * keyed, tagged and purged, so a state change shows up without per-page patches.
 *
 *  - READS (apiClient.fetchJson, workflow/designer loaders) tag every cached upstream fetch with
 *    the caller's tenant tag. Next already keys fetch entries by URL + request headers (the
 *    Authorization bearer is a header), so entries are never shared across users or tenants; the
 *    tag only scopes PURGES.
 *  - WRITES (the /api/proxy BFF, the single path every client mutation takes) call
 *    purgeTenantDataCache after a successful non-GET, dropping the tenant's cached reads. This
 *    covers the actor's own screen AND other users' next navigation/reload (their entries carry
 *    the same tenant tag), and cross-module effects (a workflow decision changes an indent).
 *  - capRevalidate bounds how long a read may be served stale even if no purge happens
 *    (an async worker finishing after the mutation returned). Values >= 300 s (static master
 *    data) are left alone.
 */
import { revalidateTag } from "next/cache";
import { PUBLIC_PREFIXES, isPublicRoute, isDeviceAuthRoute } from "@civitasone/types";

export const TENANT_TAG_PREFIX = "civ:t:";
/** Tag for a token that carries no tenant claim: purged by any mutation of such a caller. */
export const ALL_TAG = "civ:all";

/** Max seconds a dynamic read may be cached, unless overridden (env WEB_DATA_CACHE_MAX_SECONDS). */
const DEFAULT_MAX_DYNAMIC_SECONDS = 5;
const STATIC_THRESHOLD_SECONDS = 300;

/**
 * The tenant tag comes from an UNVERIFIED decode of the cookie token (the web app has no JWKS helper).
 * That is safe for reads (the tag only scopes purges) but a forged `tid` must not be able to purge
 * another tenant's cache. So a purge is only issued for gateway-AUTHENTICATED routes: there the gateway
 * has verified the bearer, a 2xx proves the token was genuine, and `tid` is its real tenant. Routes the
 * gateway serves without a bearer check come from the gateway's own list (@civitasone/types gatewayPublic)
 * and never purge.
 */
/** Final path segments of POST endpoints that only compute/look up and change no stored state. */
const READ_ONLY_LAST_SEGMENTS = new Set([
  "search", "query", "preview", "template-preview", "validate", "validate-versioned", "validate-pan",
  "duplicate-check", "simulate", "estimate", "lookup", "dry-run", "what-if",
]);

/** Whether a successful write to /api/<subpath> should drop the tenant's cached reads. */
export function shouldPurgeAfterWrite(method: string, subpath: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const pathname = "/api/" + subpath.replace(/^\/+|\/+$/g, "");
  if (isPublicRoute(m, pathname) || isDeviceAuthRoute(m, pathname)) return false;
  if (PUBLIC_PREFIXES.some((x) => pathname === x || pathname.startsWith(x + "/"))) return false;
  if (m === "POST" && READ_ONLY_LAST_SEGMENTS.has(pathname.split("/").pop() ?? "")) return false;
  return true;
}

function tenantIdFromToken(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const raw = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    const tid = (JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { tid?: unknown }).tid;
    return typeof tid === "string" && /^[A-Za-z0-9-]{1,64}$/.test(tid) ? tid : null;
  } catch {
    return null;
  }
}

/** Cache tags for a read made with this bearer token (tenant tag, or the shared fallback). */
export function dataCacheTags(token: string | undefined): string[] {
  const tid = token ? tenantIdFromToken(token) : null;
  return tid ? [TENANT_TAG_PREFIX + tid] : [ALL_TAG];
}

export function capRevalidate(seconds: number): number {
  if (seconds >= STATIC_THRESHOLD_SECONDS) return seconds;
  const envMax = Number(process.env.WEB_DATA_CACHE_MAX_SECONDS);
  const max = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_DYNAMIC_SECONDS;
  return Math.min(seconds, max);
}

/** The `next` options for a cached read: capped revalidate window plus tenant tag. */
export function cachedFetchOptions(revalidateSeconds: number, token: string | undefined): { revalidate: number; tags: string[] } {
  return { revalidate: capRevalidate(revalidateSeconds), tags: dataCacheTags(token) };
}

/**
 * Purge cached reads after a successful mutation. Tenant-scoped when the token has a tenant claim
 * (other tenants' caches are untouched). Never throws: a purge failure must not turn a committed
 * mutation into an error response.
 */
export function purgeTenantDataCache(token: string | undefined): void {
  try {
    for (const tag of dataCacheTags(token)) revalidateTag(tag);
  } catch {
    // outside a request scope (unit tests) or cache backend unavailable: reads fall back to the capped TTL.
  }
}
