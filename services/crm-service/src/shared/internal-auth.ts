/**
 * Service-to-service auth headers for crm-service -> other-service HTTP calls.
 *
 * Uses the platform's internal path (`x-internal` + `x-service-secret` +
 * `x-tenant-id`) that `@civitasone/auth` authenticates, the same one
 * notification-service's crm-consent-client.ts and crm-service's
 * identity-client.ts already use. A user token is deliberately NOT forwarded:
 * these calls run from queue consumers (no request) or on behalf of the tenant.
 *
 * Returns null when INTERNAL_SERVICE_SECRET is unset so callers can fail closed
 * (an unauthenticated call would only be rejected with a 401 anyway).
 */
export function internalServiceHeaders(
  tenantId: string,
  correlationId: string,
): Record<string, string> | null {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) return null;
  return {
    "content-type": "application/json",
    "x-internal": "1",
    "x-service-secret": secret,
    "x-internal-caller": "crm-service",
    "x-tenant-id": tenantId,
    "x-correlation-id": correlationId,
  };
}
