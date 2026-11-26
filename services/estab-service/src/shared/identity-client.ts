/**
 * Internal HTTP client for estab-service -> identity-service RBAC role keys.
 *
 * GAP-ESTAB-APPROVAL-MATRIX-03 (owner decision B22): the approver roles an approval rule may name
 * are sourced from the tenant's identity RBAC role list. That list is what GET /v1/admin/roles
 * (admin-service) relays from identity-service's GET /identity/rbac/roles; estab-service reads the
 * same identity endpoint directly over the internal x-internal + x-service-secret + x-tenant-id
 * boundary (the pattern admin/finance/crm use), because /v1/admin/roles itself is an
 * admin-gated, end-user route.
 *
 * Fails OPEN to `null` (caller then uses its built-in catalogue): this is a validation catalogue,
 * so an unreachable identity-service must not stop an administrator maintaining the matrix.
 */
import { cache } from "./infra.js";

const IDENTITY_URL = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const FETCH_TIMEOUT_MS = 3000;
const CACHE_TTL_SECONDS = 60;
const PAGE = 200;
const MAX_PAGES = 5;

async function fetchRoleKeys(tenantId: string): Promise<string[] | null> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) return null;
  const keys: string[] = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(`${IDENTITY_URL}/identity/rbac/roles?limit=${PAGE}&offset=${page * PAGE}`, {
        headers: { "x-internal": "1", "x-service-secret": serviceSecret, "x-tenant-id": tenantId },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ key?: unknown }>;
      if (!Array.isArray(rows)) return null;
      for (const r of rows) if (typeof r.key === "string") keys.push(r.key);
      if (rows.length < PAGE) break;
    }
    return keys;
  } catch {
    return null;
  }
}

/** The tenant's identity RBAC role keys, or null when identity-service cannot answer. */
export async function getIdentityRoleKeys(tenantId: string): Promise<string[] | null> {
  const out = await cache.getOrLoad<{ keys: string[] | null }>(
    cache.makeKey(tenantId, "identity-role-keys", "v1"),
    async () => ({ keys: await fetchRoleKeys(tenantId) }),
    CACHE_TTL_SECONDS,
  );
  return out?.keys ?? null;
}
