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
