/**
 * analytics-service -> hrms-service display enrichment (SF-17b).
 *
 * Dashboards carry only `owner_id` (the creating actor's identity-provider
 * subject). The web used to show its first 8 characters. This resolves actor ids
 * to a person's name through hrms-service's internal employee-summaries feed
 * (filtered server-side by `actorIds`, tenant-scoped by x-tenant-id), the same
 * sanctioned display-enrichment endpoint estab-service and payroll-service use.
 *
 * Display enrichment only: it never throws and never blocks a dashboard read. An
 * actor that is not linked to an employee, is in another tenant, or an hrms
 * outage all simply produce no entry, and the UI renders "Unknown employee".
 */
const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";
const FETCH_TIMEOUT_MS = 2000;
const IDS_PER_REQUEST = 40;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Summary = { fullName?: unknown; userRef?: unknown };

async function fetchChunk(tenantId: string, actorIds: string[]): Promise<Summary[]> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return [];
  try {
    const res = await fetch(`${HRMS_URL}/v1/hrms/internal/employee-summaries?actorIds=${actorIds.map(encodeURIComponent).join(",")}`, {
      headers: { "x-internal": "1", "x-service-secret": secret, "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as Summary[]) : [];
  } catch {
    return [];
  }
}

/** actorId -> person name, for exactly the given actor ids (batched). */
export async function resolveActorNames(tenantId: string, actorIds: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(actorIds.filter((i): i is string => typeof i === "string" && UUID_RE.test(i)))];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST * 8) {
    const wave: string[][] = [];
    for (let j = i; j < Math.min(unique.length, i + IDS_PER_REQUEST * 8); j += IDS_PER_REQUEST) wave.push(unique.slice(j, j + IDS_PER_REQUEST));
    const parts = await Promise.all(wave.map((c) => fetchChunk(tenantId, c)));
    for (const rows of parts) {
      for (const r of rows) {
        // Only trust a row whose userRef is one we asked for: an older hrms-service that
        // ignores the filter returns the whole feed, and we must not label by accident.
        if (typeof r.userRef === "string" && typeof r.fullName === "string" && r.fullName && unique.includes(r.userRef)) out.set(r.userRef, r.fullName);
      }
    }
  }
  return out;
}
