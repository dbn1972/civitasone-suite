/**
 * GAP-ADMIN-INTEGRATIONS-04: resolve user ids to display names for enrichment.
 *
 * Uses identity-service's tenant-scoped internal summaries endpoint (id + name
 * only, no email/status) over the internal-elevation headers. The lookup is
 * tenant-scoped by identity-service itself, so an id belonging to another
 * tenant simply does not resolve. Fail-OPEN to an empty map: this is display
 * enrichment, an unreachable identity-service must degrade to "no name", never
 * break the page.
 */
export async function fetchUserNames(tenantId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const wanted = new Set([...ids].filter((v) => typeof v === "string" && v.length > 0));
  if (wanted.size === 0) return new Map();
  const base = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.GAP_UPSTREAM_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Array<{ id?: unknown; name?: unknown }>;
    const out = new Map<string, string>();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim() && wanted.has(r.id)) out.set(r.id, r.name.trim());
    }
    return out;
  } catch {
    return new Map();
  }
}
