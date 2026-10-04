/**
 * Resolve the tenant's ACTIVE tenant_admin users from identity-service (id, name, email), within the
 * tenant of the call. billing-service stores no contact of its own. Distinguishes "identity-service could not be
 * asked" (unavailable) from "asked, nobody there" (empty list) so the caller never reports a silent success.
 */
export type Recipient = { id: string; name: string; email: string };
export type RecipientLookup = { ok: true; recipients: Recipient[] } | { ok: false };

export async function fetchTenantAdminRecipients(tenantId: string): Promise<RecipientLookup> {
  const base = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/identity/internal/tenant-admins`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000)),
    });
    if (!res.ok) return { ok: false };
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return { ok: false };
    const out: Recipient[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      if (typeof r.id === "string" && typeof r.email === "string" && /^\S+@\S+\.\S+$/.test(r.email)) {
        out.push({ id: r.id, name: typeof r.name === "string" && r.name ? r.name : "Administrator", email: r.email });
      }
    }
    return { ok: true, recipients: out };
  } catch {
    return { ok: false };
  }
}
