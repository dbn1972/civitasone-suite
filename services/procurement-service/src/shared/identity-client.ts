const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/**
 * Bug fix (raw-id-leaked-to-ui): resolves a tenant's user ids to their real
 * display names for enrichment, e.g. Purchase Indents' "Requested By" column
 * (indent.procurement_indents has no requester_id/requester_name column --
 * created_by IS the requester, but it's a raw identity-service user uuid).
 * Mirrors payroll-service/src/shared/hrms-client.ts's fetchEmployeeSummaries:
 * same internal-elevation headers, same fail-OPEN-to-empty-Map contract
 * (this is a display enrichment, not a correctness-critical read -- an
 * unreachable identity-service should degrade to the caller's own
 * genuinely-unavailable fallback, never break the indents list).
 */
export async function fetchUserSummaries(tenantId: string): Promise<Map<string, { name: string }>> {
  const url = `${IDENTITY_URL}/identity/internal/user-summaries`;
  try {
    const res = await fetch(url, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = await res.json() as Array<{ id: string; name: string }>;
    return new Map(rows.map((r) => [r.id, { name: r.name }]));
  } catch {
    return new Map();
  }
}

const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * W3: resolve approval-trail actors (JWT subs) to display names. Login personas are not always
 * rows in identity's user directory (they exist as Keycloak users), so the identity lookup alone
 * left every actor "Unknown user". Same two-step as workflow-service's people-client: the HRMS
 * employee linked to the login first (userRef -> fullName), then identity's user-summaries for
 * the ids HRMS did not know. Fails soft: an id nobody resolves is absent from the map.
 */
export async function fetchActorNames(tenantId: string, actorIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = [...new Set([...actorIds].filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const res = await fetch(`${HRMS_URL}/v1/hrms/internal/employee-summaries?actorIds=${ids.slice(i, i + 50).join(",")}`, {
        headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
        signal: AbortSignal.timeout(Number(process.env.HRMS_LOOKUP_TIMEOUT_MS ?? 2000)),
      });
      if (!res.ok) continue;
      const rows = await res.json() as unknown;
      if (!Array.isArray(rows)) continue;
      for (const r of rows as Array<{ userRef?: unknown; fullName?: unknown }>) {
        if (typeof r?.userRef === "string" && typeof r.fullName === "string" && r.fullName.trim()) out.set(r.userRef, r.fullName.trim());
      }
    } catch { /* fail soft: fall through to identity */ }
  }
  if (ids.every((id) => out.has(id))) return out;
  const users = await fetchUserSummaries(tenantId);
  for (const id of ids) {
    const name = users.get(id)?.name;
    if (!out.has(id) && name) out.set(id, name);
  }
  return out;
}
