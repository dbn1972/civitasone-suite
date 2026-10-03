const TENANT_URL = process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002";
const TTL_MS = 60_000;
const cache = new Map<string, { edition: string; at: number }>();

/**
 * The tenant's packaged edition (tenant.tenants.edition: govt | govt_dept | psu | private | ngo | section8 |
 * cooperative | small_office), read from tenant-service GET /v1/tenants/:id over the same x-internal +
 * service-secret boundary the gateway uses for it. Neither the JWT nor a forwarded header carries the edition.
 * Fails CLOSED: any error, non-2xx or malformed body answers undefined (callers must not assume a permissive
 * value). Successful answers are cached for a minute; failures are never cached.
 */
export async function fetchTenantEdition(tenantId: string): Promise<string | undefined> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.edition;
  try {
    const res = await fetch(`${TENANT_URL}/v1/tenants/${encodeURIComponent(tenantId)}`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { edition?: unknown };
    if (typeof body.edition !== "string" || body.edition.trim() === "") return undefined;
    const edition = body.edition.trim().toLowerCase();
    cache.set(tenantId, { edition, at: Date.now() });
    return edition;
  } catch {
    return undefined;
  }
}

/** Test hook. */
export function resetTenantEditionCache(): void {
  cache.clear();
}
