/**
 * Owner decision #25: the test-send recipient is the CALLING admin's own address,
 * read from identity-service (the only store of a user contact). notification-service
 * keeps no copy. Fails CLOSED: undefined on any error, so the caller records a
 * failed test rather than guessing an address.
 */
export async function fetchActorEmail(tenantId: string, actorId: string): Promise<string | undefined> {
  const base = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/identity/internal/users/${encodeURIComponent(actorId)}/email`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { email?: unknown };
    return typeof body.email === "string" && /^\S+@\S+\.\S+$/.test(body.email) ? body.email : undefined;
  } catch {
    return undefined;
  }
}
