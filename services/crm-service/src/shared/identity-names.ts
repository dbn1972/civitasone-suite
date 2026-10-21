/**
 * Read-only display-name lookup for user ids (GAP-CRM-OPPORTUNITY-AGEING-03,
 * GAP-CRM-PRICE-BOOKS-01, GAP-CRM-PRODUCTS-01).
 *
 * crm tables store only the identity user id (`owner_id`, `updated_by`, ...), so a
 * list that must show WHO ("owner to chase", "last changed by") has to resolve the id
 * to a name. Identity-service is the source of truth; it exposes a minimal, tenant-scoped
 * `{ id, name }` summary list over the established x-internal + x-service-secret +
 * x-tenant-id service-to-service path (no email, status or other PII leaves identity).
 *
 * DISPLAY ENRICHMENT ONLY: any failure (outage, timeout, non-2xx) resolves to an empty
 * map and callers surface `null`/"unknown" — a name lookup must never break, or block,
 * the record being read. Failures are not cached. Ids that do not belong to the tenant
 * simply do not resolve (identity scopes the list by x-tenant-id).
 */
const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";
const TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;

const cache = new Map<string, { at: number; names: Map<string, string> }>();

async function loadTenantNames(tenantId: string): Promise<Map<string, string> | null> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    const names = new Map<string, string>();
    for (const r of Array.isArray(rows) ? (rows as Array<{ id?: unknown; name?: unknown }>) : []) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) names.set(r.id, r.name.trim());
    }
    cache.set(tenantId, { at: Date.now(), names });
    return names;
  } catch {
    return null;
  }
}

/** Display names for the given user ids; ids that cannot be resolved are simply absent. */
export async function resolveUserNames(
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0));
  if (wanted.size === 0) return new Map();
  const all = await loadTenantNames(tenantId);
  const out = new Map<string, string>();
  if (!all) return out;
  for (const id of wanted) {
    const n = all.get(id);
    if (n) out.set(id, n);
  }
  return out;
}

/** Test hook: drop the in-process name cache. */
export function clearIdentityNameCache(): void {
  cache.clear();
}
