const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";
const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/** A person as an approver should see them: a name and, when HR knows it, a designation. Never an id. */
export type Person = { name: string; designation: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** hrms employee-summaries caps an actorIds filter at 50 ids. */
const HRMS_IDS_PER_CALL = 50;

function internalHeaders(tenantId: string): Record<string, string> {
  return { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId };
}

type HrmsSummary = { userRef?: unknown; fullName?: unknown; designationName?: unknown };

/**
 * UX R1: resolve identity actor ids (task makers, trail actors) to "Name, Designation" in a bounded
 * number of calls: one hrms employee-summaries call per 50 ids (the employee linked to the login,
 * with its designation), then ONE identity user-summaries call for any id hrms did not know (a login
 * with no employee record still has a name). Tenant-scoped through the internal service path.
 * Fails soft: an id nobody resolves is simply absent; the caller shows "Name not recorded".
 */
export async function resolvePeople(
  tenantId: string,
  actorIds: Iterable<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, Person>> {
  const ids = [...new Set([...actorIds].filter((id) => typeof id === "string" && UUID_RE.test(id)))];
  const out = new Map<string, Person>();
  if (ids.length === 0) return out;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += HRMS_IDS_PER_CALL) chunks.push(ids.slice(i, i + HRMS_IDS_PER_CALL));
  const timeout = Number(process.env.HRMS_LOOKUP_TIMEOUT_MS ?? 2000);
  await Promise.all(chunks.map(async (chunk) => {
    try {
      const res = await fetchImpl(`${HRMS_URL}/v1/hrms/internal/employee-summaries?actorIds=${chunk.join(",")}`, {
        headers: internalHeaders(tenantId),
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return;
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) return;
      for (const r of rows as HrmsSummary[]) {
        if (typeof r?.userRef !== "string" || typeof r.fullName !== "string" || !r.fullName.trim()) continue;
        out.set(r.userRef, {
          name: r.fullName.trim(),
          designation: typeof r.designationName === "string" && r.designationName.trim() ? r.designationName.trim() : null,
        });
      }
    } catch {
      /* fail soft: fall through to identity */
    }
  }));
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length === 0) return out;
  try {
    const res = await fetchImpl(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000)),
    });
    if (res.ok) {
      const rows = (await res.json()) as unknown;
      if (Array.isArray(rows)) {
        const wanted = new Set(missing);
        for (const r of rows as Array<{ id?: unknown; name?: unknown }>) {
          if (typeof r?.id === "string" && wanted.has(r.id) && typeof r.name === "string" && r.name.trim()) {
            out.set(r.id, { name: r.name.trim(), designation: null });
          }
        }
      }
    }
  } catch {
    /* fail soft */
  }
  return out;
}
