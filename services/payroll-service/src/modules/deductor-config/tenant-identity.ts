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
 * same body parsing ({ data: { settings } } or { settings }), same 60 s cache
 * and the same fail-OPEN behaviour (tenant-service down / non-2xx / bad body
 * -> an empty identity, never an error).
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
}

export const EMPTY_TENANT_DOC_IDENTITY: TenantDocIdentity = {
  orgName: null, tenantName: null, address: null, tan: null, pan: null, deductorCategory: null,
};

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

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const cache = new Map<string, { value: TenantDocIdentity; at: number }>();
const TTL_MS = 60_000;

/** The tenant document identity; EMPTY_TENANT_DOC_IDENTITY when tenant-service cannot be read. */
export async function readTenantDocIdentity(tenantId: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<TenantDocIdentity> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const base = (process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/tenants/${encodeURIComponent(tenantId)}`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return EMPTY_TENANT_DOC_IDENTITY;
    const body = (await res.json()) as { name?: unknown; settings?: unknown; data?: { name?: unknown; settings?: unknown } } | null;
    const value = tenantDocIdentityFrom(body?.data ?? body);
    cache.set(tenantId, { value, at: Date.now() });
    return value;
  } catch {
    return EMPTY_TENANT_DOC_IDENTITY;
  }
}

/** Test hook. */
export function resetTenantDocIdentityCache(): void { cache.clear(); }
