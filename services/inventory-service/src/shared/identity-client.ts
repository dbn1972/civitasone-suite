/**
 * Read-only client to identity-service for DISPLAY names of user ids
 * (GAP-INVENTORY-GOODS-RETURNS-DETAIL-05 / -CYCLE-COUNTS-DETAIL-03). Uses the
 * existing minimal tenant-scoped internal summaries endpoint (id + name only, no
 * email/PII) over the same x-internal + x-service-secret + x-tenant-id path the
 * procurement-service indent list already uses. Display enrichment only: any
 * failure yields an empty map and the web falls back to a neutral label -- it
 * must never break the record being read.
 */
const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";
const TTL_MS = 60_000;

const cache = new Map<string, { at: number; names: Map<string, string> }>();

async function loadTenantNames(tenantId: string): Promise<Map<string, string>> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.names;
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = await res.json() as Array<{ id?: unknown; name?: unknown }>;
    const names = new Map<string, string>();
    for (const r of rows) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) names.set(r.id, r.name.trim());
    }
    cache.set(tenantId, { at: Date.now(), names });
    return names;
  } catch {
    return new Map();
  }
}

/** Names for the given user ids; ids that cannot be resolved are simply absent. */
export async function resolveUserNames(tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0))];
  if (wanted.length === 0) return new Map();
  const all = await loadTenantNames(tenantId);
  const out = new Map<string, string>();
  for (const id of wanted) {
    const n = all.get(id);
    if (n) out.set(id, n);
  }
  return out;
}

/** Test hook. */
export function clearIdentityNameCache(): void {
  cache.clear();
}
