/**
 * F9: the tenant's edition (govt / govt_dept / small_office / psu ...) is owned by tenant-service.
 * billing-service keeps no copy; it asks tenant-service for the CALLER's own tenant, forwarding
 * the caller's bearer token so tenant-service applies its own authz and RLS. Fails OPEN to null
 * (edition unknown) so a tenant-service outage degrades the payment-mode hint instead of
 * failing the whole plans read.
 */
export async function fetchTenantEdition(authorization: string | undefined): Promise<string | null> {
  if (!authorization) return null;
  const base = (process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/v1/tenants/current`, {
      headers: { authorization },
      signal: AbortSignal.timeout(Number(process.env.TENANT_LOOKUP_TIMEOUT_MS ?? 3000)),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { edition?: unknown };
    return typeof body.edition === "string" && body.edition.length > 0 ? body.edition : null;
  } catch {
    return null;
  }
}
