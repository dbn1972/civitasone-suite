/**
 * UAT P3 b19 D-15 (review decision 1): the TDS deductor identity has ONE
 * source, shared with the official-document renderer of PR #2463: the tenant
 * configuration in tenant-service, `settings.documentIdentity`
 * { orgName, tan, pan, address, deductorCategory, ... }, set by the tenant
 * administrator (PATCH /v1/tenants/:id { settings: { documentIdentity } }).
 *
 * This is a small LOCAL copy of `resolveDocIdentity` from
 * packages/render/src/official/identity.ts (#2463), which is not on this
 * branch yet. Same request (GET {TENANT_SERVICE_URL}/v1/tenants/:id with
 * x-internal: 1, x-service-secret: INTERNAL_SERVICE_SECRET, x-tenant-id),
 * same body parsing ({ data: { settings } } or { settings }) and same 60 s
 * cache, but it FAILS CLOSED: tenant-service down / timeout / non-2xx / bad
 * body throws TenantIdentityUnavailableError (-> 503 at the route), never an
 * empty identity, so a transient failure can never fall through to another
 * deductor's deployment-wide EMPLOYER_* values. A successful read of a tenant
 * with no documentIdentity is a normal empty identity (-> 422 not configured).
 *
 * Two different answers, told apart on purpose:
 *   - tenant-service ANSWERED that it has no such tenant (HTTP 404 with the NOT_FOUND code its own
 *     error handler sends): nothing is configured and retrying cannot help. That is "employer not
 *     configured" (-> 422 FORM16_EMPLOYER_NOT_CONFIGURED, `registered: false`), not an outage.
 *   - everything else (network error, timeout, 5xx, 401/403 refused credential, a 404 that is not
 *     tenant-service's NOT_FOUND answer such as a mis-routed URL, an unreadable body): the identity
 *     is UNKNOWN, so it fails closed (-> 503). The 503 names the HTTP status.
 * TODO(rebase onto #2463): switch to `resolveDocIdentity` from
 * @civitasone/render/official and delete this file (add `deductorCategory` to
 * its DocIdentity if it is not there yet).
 */

export interface TenantDocIdentity {
  /** documentIdentity.orgName only (NOT the tenant name; see tenantName). */
  orgName: string | null;
  /** The tenant display name (#2463 uses it when documentIdentity.orgName is absent). */
  tenantName: string | null;
  address: string | null;
  tan: string | null;
  pan: string | null;
  /** documentIdentity.deductorCategory, lower-cased ("government" for a Central / State Government deductor). */
  deductorCategory: string | null;
  /** false only when tenant-service answered 404 NOT_FOUND for this tenant (absent = registered). */
  registered?: boolean;
}

/** A tenant that was read successfully but has no documentIdentity. */
export const EMPTY_TENANT_DOC_IDENTITY: TenantDocIdentity = {
  orgName: null, tenantName: null, address: null, tan: null, pan: null, deductorCategory: null,
};
/** tenant-service has no record of this tenant: nothing can be configured for it. */
export const UNREGISTERED_TENANT_DOC_IDENTITY: TenantDocIdentity = { ...EMPTY_TENANT_DOC_IDENTITY, registered: false };

/** tenant-service could not be read; the deductor identity is unknown (fail closed). */
export class TenantIdentityUnavailableError extends Error {
  constructor(reason: string) { super(`tenant document identity unavailable: ${reason}`); }
}

export const DOC_IDENTITY_SETTING = "documentIdentity";

const str = (v: unknown, max = 400): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Parse a tenant record ({ name, settings }) the way #2463 docIdentityFromTenant does. */
export function tenantDocIdentityFrom(tenant: { name?: unknown; settings?: unknown } | null | undefined): TenantDocIdentity {
  const settings = tenant && typeof tenant.settings === "object" && tenant.settings !== null ? (tenant.settings as Record<string, unknown>) : {};
  const raw = settings[DOC_IDENTITY_SETTING];
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    orgName: str(d.orgName, 200),
    tenantName: str(tenant?.name, 200),
    address: str(d.address, 400),
    tan: str(d.tan, 10)?.toUpperCase() ?? null,
    pan: str(d.pan, 10)?.toUpperCase() ?? null,
    deductorCategory: str(d.deductorCategory, 40)?.toLowerCase() ?? null,
  };
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

/** True when a non-2xx reply is tenant-service's own "no such tenant" answer (404 + code NOT_FOUND). */
async function isTenantNotFound(res: { status?: number; json(): Promise<unknown> }): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const b = (await res.json()) as { code?: unknown; error?: { code?: unknown } } | null;
    return b?.code === "NOT_FOUND" || b?.error?.code === "NOT_FOUND";
  } catch {
    return false;
  }
}

const cache = new Map<string, { value: TenantDocIdentity; at: number }>();
const TTL_MS = 60_000;

/** The tenant document identity; throws TenantIdentityUnavailableError when tenant-service cannot be read. */
export async function readTenantDocIdentity(tenantId: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TenantDocIdentity> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const base = (process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${base}/v1/tenants/${encodeURIComponent(tenantId)}`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(3000),
    });
  } catch (err) {
    throw new TenantIdentityUnavailableError(err instanceof Error ? err.message : "request failed");
  }
  if (!res.ok) {
    if (await isTenantNotFound(res)) {
      cache.set(tenantId, { value: UNREGISTERED_TENANT_DOC_IDENTITY, at: Date.now() });
      return UNREGISTERED_TENANT_DOC_IDENTITY;
    }
    throw new TenantIdentityUnavailableError(`tenant-service returned HTTP ${res.status ?? "non-2xx"}`);
  }
  let body: { name?: unknown; settings?: unknown; data?: { name?: unknown; settings?: unknown } } | null;
  try { body = (await res.json()) as typeof body; } catch { throw new TenantIdentityUnavailableError("unreadable response body"); }
  const tenant = body?.data ?? body;
  if (!tenant || typeof tenant !== "object") throw new TenantIdentityUnavailableError("response body is not a tenant record");
  const value = tenantDocIdentityFrom(tenant);
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** Test hook. */
export function resetTenantDocIdentityCache(): void { cache.clear(); }
