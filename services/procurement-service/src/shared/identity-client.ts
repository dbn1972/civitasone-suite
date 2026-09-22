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
