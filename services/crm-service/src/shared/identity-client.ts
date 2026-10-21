const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";
const NAME_TTL_MS = 60_000;

/**
 * Is `userId` a real, ACTIVE user of `tenantId`? Asks identity-service (the source of truth for
 * users) over the established x-internal + x-service-secret + x-tenant-id service-to-service path.
 *
 * Returns true/false when identity answered (404 or a non-active status is a definite false), and
 * `undefined` when it could not be verified (outage, timeout, unexpected status). Fails CLOSED:
 * callers must treat `undefined` as "not verified", never as permitted.
 */
export async function isActiveTenantUser(tenantId: string, userId: string): Promise<boolean | undefined> {
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/users/${encodeURIComponent(userId)}/status`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return false;
    if (!res.ok) return undefined;
    const body = (await res.json()) as { status?: string };
    return body.status === "active";
  } catch {
    return undefined;
  }
}

/**
 * Display names for a tenant's users (id -> name), so a CRM roster/directory never has to
 * show a raw user uuid (GAP-CRM-AGENT-WORKLOAD-05: crm.agent_workload stores only the
 * agent_id). Display-only enrichment over identity-service's internal user-summaries
 * lookup (id + name only, no email/PII), using the same x-internal + x-service-secret +
 * x-tenant-id elevation as the other peer-service clients. Fails OPEN to an empty Map: an
 * unreachable identity-service degrades to "no name" (the UI then shows a neutral label);
 * it never breaks the CRM read.
 *
 * A successful lookup is cached per tenant for a minute: the web agent pickers call the
 * roster on every keystroke, and the directory (up to ~2000 users) is not worth fetching
 * each time. A failed lookup is never cached, so recovery is immediate.
 */
const nameCache = new Map<string, { at: number; names: Map<string, string> }>();

/** Test hook: forget every cached directory. */
export function clearUserNameCache(): void {
  nameCache.clear();
}

export async function fetchUserNames(tenantId: string): Promise<Map<string, string>> {
  const hit = nameCache.get(tenantId);
  if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.names;
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const rows = (await res.json()) as Array<{ id?: unknown; name?: unknown }>;
    const names = new Map<string, string>();
    for (const r of rows) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) names.set(r.id, r.name.trim());
    }
    nameCache.set(tenantId, { at: Date.now(), names });
    return names;
  } catch {
    return new Map();
  }
}

/**
 * Display names for user ids (GAP-CRM-CONTACTS-DETAIL-01: the owner/agent
 * pickers had ids only, so every option read "Unnamed agent"). Uses the same
 * minimal tenant-scoped identity-service summaries endpoint (id + name only, no
 * email or other PII) and the same x-internal service path that the meeting,
 * finance, inventory and procurement services use. Display enrichment only: any
 * failure yields an empty map and the caller simply omits `name`; it must never
 * fail the read it decorates. Ids that cannot be resolved are absent.
 */
export async function resolveUserNames(
  tenantId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0))];
  if (wanted.length === 0) return new Map();
  const all = await fetchUserNames(tenantId);
  const out = new Map<string, string>();
  for (const id of wanted) {
    const n = all.get(id);
    if (n) out.set(id, n);
  }
  return out;
}

/** Test hook: clear the in-process name cache. */
export function clearIdentityNameCache(): void {
  clearUserNameCache();
}
