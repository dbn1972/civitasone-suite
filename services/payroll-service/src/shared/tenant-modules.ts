/**
 * Which modules a tenant has, as payroll-service needs to know it (M9: payroll
 * without Finance).
 *
 * ONE small accessor on purpose: today it reads the admin-service composition
 * projection (GET /v1/admin/composition/internal/:tenantId/modules), the same
 * source the gateway module guard and smarttransfer's entitlement check use.
 * When the module catalogue becomes the single source (draft #2516,
 * MODULE_SOURCE=catalogue) only `fetchModuleKeys` below changes; no caller does.
 *
 * Unlike smarttransfer's entitlement guard this FAILS TOWARDS TODAY'S BEHAVIOUR:
 * an unreachable admin-service, an open breaker, a non-2xx answer, a tenant that
 * was never composed (`configured:false`) or a malformed tenant id all answer
 * "the tenant has the module". Every existing tenant has Finance, so an outage
 * must never silently switch a tenant's salary onto the export-only path.
 * A definite answer is cached for 30 s; a failure only for 5 s.
 */
import { CircuitBreaker } from "@civitasone/circuit-breaker";

const breaker = new CircuitBreaker({ name: "payroll-tenant-modules-admin", failureThreshold: 3, recoveryMs: 10_000 });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFINITE_TTL_MS = 30_000;
const FAILED_TTL_MS = 5_000;

/** The module keys a tenant has (gateway route keys, e.g. "finance"), or null when that cannot be known. */
export type ModuleKeyFetcher = (tenantId: string) => Promise<string[] | null>;

export const fetchModuleKeysFromAdmin: ModuleKeyFetcher = async (tenantId) => {
  const adminUrl = process.env.GATEWAY_ADMIN_URL ?? "http://127.0.0.1:3022";
  const url = `${adminUrl}/v1/admin/composition/internal/${encodeURIComponent(tenantId)}/modules`;
  try {
    const body = await breaker.call(async () => {
      const res = await fetch(url, {
        headers: {
          "x-internal": "1",
          "x-tenant-id": tenantId,
          // admin-service reads x-service-secret in its global auth hook and x-internal-secret in the route itself.
          "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-internal-caller": "payroll-service-modules",
        },
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw new Error(`admin-service ${res.status}`);
      return (await res.json()) as { configured?: boolean; data?: Array<{ name: string }> };
    });
    if (body.configured === false) return null; // never composed: a legacy tenant, keeps every module
    if (!Array.isArray(body.data)) return null; // not the projection we expected: unknown, not "no modules"
    return body.data.map((m) => m.name);
  } catch {
    return null;
  }
};

let fetcher: ModuleKeyFetcher = fetchModuleKeysFromAdmin;
const cache = new Map<string, { at: number; ttl: number; keys: string[] | null }>();

/** Test seam: replace (or restore, with no argument) the module source and clear the cache. */
export function setModuleKeyFetcher(f?: ModuleKeyFetcher): void {
  fetcher = f ?? fetchModuleKeysFromAdmin;
  cache.clear();
}

async function moduleKeys(tenantId: string): Promise<string[] | null> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.keys;
  const keys = await fetcher(tenantId).catch(() => null);
  cache.set(tenantId, { at: Date.now(), ttl: keys === null ? FAILED_TTL_MS : DEFINITE_TTL_MS, keys });
  return keys;
}

/** True unless the tenant is KNOWN not to have `moduleKey` (see the file header: unknown means yes). */
export async function tenantHasModule(tenantId: string, moduleKey: string): Promise<boolean> {
  if (!UUID_RE.test(tenantId)) return true;
  const keys = await moduleKeys(tenantId);
  return keys === null ? true : keys.includes(moduleKey);
}

/**
 * Without INTERNAL_SERVICE_SECRET every lookup is refused by admin-service, so the fail-safe answers "has Finance" for
 * every tenant and a tenant without Finance never reaches export mode unless an explicit override is set. Say so at boot.
 */
export function warnIfModuleLookupUnconfigured(log: { warn: (o: object, m: string) => void }): void {
  if (!process.env.INTERNAL_SERVICE_SECRET) {
    log.warn({ var: "INTERNAL_SERVICE_SECRET" }, "INTERNAL_SERVICE_SECRET is not set: tenant module lookups will fail and every tenant is treated as having Finance; export-only ledger mode engages only through an explicit override");
  }
}
