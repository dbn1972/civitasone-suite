const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/**
 * Resolves a tenant's identity user ids to display names so list/detail
 * payloads never have to expose a raw user uuid to the UI (actor columns such
 * as "Closed By"). Display-only enrichment over the identity-service internal
 * user-summaries lookup, using the same x-internal + x-service-secret +
 * x-tenant-id elevation as the other peer-service clients. Fails OPEN to an
 * empty Map: an unreachable identity-service degrades to "no name" (the UI
 * then shows a neutral label), it never breaks the finance read.
 */
export async function fetchUserSummaries(tenantId: string): Promise<Map<string, { name: string }>> {
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    return new Map(rows.map((r) => [r.id, { name: r.name }]));
  } catch {
    return new Map();
  }
}

/** Display name for an actor id, or null when unknown (caller shows a neutral label, never the raw id). */
export function actorName(names: Map<string, { name: string }>, id: string | null | undefined): string | null {
  if (!id) return null;
  return names.get(id)?.name ?? null;
}
