const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

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
