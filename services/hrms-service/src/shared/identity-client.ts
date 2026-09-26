const IDENTITY_URL = process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";

/**
 * SEC fix (self-service identity hijack -- see actor-link.ts's
 * resolveEmployeeForActor doc comment for the full vulnerability writeup):
 * resolves the CALLER'S OWN verified email from identity-service (the
 * Keycloak-backed source of truth for user records), keyed strictly by
 * their own JWT-verified actorId. This is the only trusted email source for
 * the actor-link email-fallback bootstrap -- it replaces trusting a
 * client-supplied x-user-email header, which had no relationship to the
 * authenticated caller at all.
 *
 * There is no parameter here through which a caller could ask for a
 * DIFFERENT user's email: the lookup key is always the actorId the calling
 * service itself derived from a verified JWT (ctx.actorId), sent over the
 * same established x-internal + x-service-secret + x-tenant-id boundary
 * every other internal service-to-service call in this codebase uses (see
 * e.g. procurement-service/src/shared/identity-client.ts's
 * fetchUserSummaries, payroll-service/src/shared/hrms-client.ts).
 *
 * Fails CLOSED (returns undefined on any error/non-2xx/unreachable), unlike
 * display-only helpers elsewhere (e.g. fetchUserSummaries) that fail open to
 * an empty result -- this result feeds a security-relevant identity link,
 * not a cosmetic label, so an identity-service outage must degrade to "the
 * auto-link bootstrap doesn't happen this one time" (safe and retryable),
 * never to a permissive fallback.
 */
export async function fetchVerifiedActorEmail(tenantId: string, actorId: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${IDENTITY_URL}/identity/internal/users/${encodeURIComponent(actorId)}/email`,
      {
        headers: {
          "x-internal": "1",
          "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-tenant-id": tenantId,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { id: string; email: string };
    return body.email;
  } catch {
    return undefined;
  }
}
