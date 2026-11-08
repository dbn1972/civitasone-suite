const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/**
 * Role keys a user CURRENTLY holds in identity-service's RBAC (GET
 * /identity/rbac/users/:userId/effective, over the x-internal + x-service-secret
 * + x-tenant-id service-to-service path; same call hrms-service uses).
 *
 * Fails CLOSED: returns undefined on any error / non-2xx / unreachable, so a
 * caller must treat "could not verify" as "not verified", never as permitted.
 */
export async function fetchUserRoleKeys(tenantId: string, userId: string): Promise<string[] | undefined> {
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/rbac/users/${encodeURIComponent(userId)}/effective`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { roles?: Array<{ key?: unknown }> };
    if (!Array.isArray(body.roles)) return undefined;
    return body.roles.flatMap((r) => (typeof r.key === "string" ? [r.key] : []));
  } catch {
    return undefined;
  }
}


/**
 * UAT T-EDGE TE-08: display name of a user (identity-service internal user-summaries, the same
 * lookup finance-service uses for actor names). Fails OPEN to null: an unreachable
 * identity-service only drops the name from the message ("another officer"), never the answer.
 */
export async function fetchUserDisplayName(tenantId: string, userId: string): Promise<string | null> {
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ id?: unknown; name?: unknown }>;
    if (!Array.isArray(rows)) return null;
    const hit = rows.find((r) => r.id === userId);
    return typeof hit?.name === "string" && hit.name.trim() ? hit.name : null;
  } catch {
    return null;
  }
}
