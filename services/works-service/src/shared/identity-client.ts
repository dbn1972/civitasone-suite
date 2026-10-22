const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/**
 * Resolves identity user ids to display names so a works payload never has to leave a raw user uuid for the UI to
 * guess at (for example the officer who recorded a contractor rating). Display-only enrichment over the
 * identity-service internal user-summaries lookup, over the same x-internal + x-service-secret + x-tenant-id
 * service-to-service path every other peer client in this codebase uses (see finance-service/src/shared/identity-client.ts).
 *
 * Fails OPEN to an empty Map: an unreachable identity-service degrades to "no name" (the web then shows a neutral
 * dash), it never breaks the works read. Only {id, name} cross the boundary, and only the ids asked for are kept.
 */
export async function fetchUserNames(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = new Set(ids);
  if (wanted.size === 0) return new Map();
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    return new Map(rows.filter((r) => wanted.has(r.id) && typeof r.name === "string" && r.name.trim() !== "").map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}
