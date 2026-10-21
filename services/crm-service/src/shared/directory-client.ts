/**
 * Read-only tenant directory (roles + users) for CRM admin screens.
 *
 * crm-service owns neither: identity-service owns users, policy-service owns
 * roles. Their own list endpoints are gated to platform/tenant admins, so a CRM
 * administrator (crm_admin) cannot read them from the browser -- the escalation
 * rule editor's pickers were therefore empty for exactly the people who use it
 * and fell back to free text. This asks the owning services server-side over the
 * established x-internal + x-service-secret + x-tenant-id service-to-service path
 * (same as identity-client.ts), scoped to the CALLER's verified tenant, and hands
 * crm-service only what an editor needs (a role name, a user id + display name).
 *
 * Every function returns `undefined` when the answer could not be obtained
 * (outage, timeout, unexpected status or shape). Callers fail CLOSED: an
 * unverifiable recipient is never treated as valid.
 */

const FETCH_TIMEOUT_MS = 5000;
/** identity-service caps a page at 200 (tenantIdQuery); the picker reads a bounded number of pages. */
const USER_PAGE_SIZE = 200;
const USER_MAX_PAGES = 5;

function internalHeaders(tenantId: string): Record<string, string> {
  return {
    "x-internal": "1",
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-tenant-id": tenantId,
  };
}

const identityUrl = (): string => process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001";
const policyUrl = (): string => process.env.POLICY_SERVICE_URL ?? "http://127.0.0.1:3003";

/** Tolerate a bare array or a { data: [...] } wrapper. */
function rowsOf(body: unknown): Array<Record<string, unknown>> | undefined {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : undefined;
  if (!list) return undefined;
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

/**
 * Names of the tenant's ACTIVE roles (policy-service GET /policy/roles). A role's
 * name is the key an escalation rule stores in `recipientRole`.
 */
export async function listTenantRoleNames(tenantId: string): Promise<string[] | undefined> {
  try {
    const res = await fetch(`${policyUrl()}/policy/roles`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const rows = rowsOf(await res.json());
    if (!rows) return undefined;
    return rows
      .filter((r) => typeof r["name"] === "string" && (r["status"] === undefined || r["status"] === "active"))
      .map((r) => r["name"] as string);
  } catch {
    return undefined;
  }
}

export interface DirectoryUser {
  id: string;
  name: string;
}

/**
 * The tenant's ACTIVE users (identity-service GET /identity/users), id + display
 * name only -- no email, employee code or MFA state. Bounded to USER_MAX_PAGES
 * pages; `truncated` is true when more users exist than were read, so a caller
 * must not treat absence from the list as proof a user does not exist (use
 * identity-client's isActiveTenantUser for an exact check).
 */
export async function listActiveTenantUsers(
  tenantId: string,
): Promise<{ users: DirectoryUser[]; truncated: boolean } | undefined> {
  const users: DirectoryUser[] = [];
  try {
    for (let page = 0; page < USER_MAX_PAGES; page++) {
      const res = await fetch(
        `${identityUrl()}/identity/users?limit=${USER_PAGE_SIZE}&offset=${page * USER_PAGE_SIZE}`,
        { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) return undefined;
      const rows = rowsOf(await res.json());
      if (!rows) return undefined;
      for (const r of rows) {
        if (typeof r["id"] === "string" && r["status"] === "active") {
          const name = typeof r["name"] === "string" && r["name"].trim() ? r["name"].trim() : r["id"];
          users.push({ id: r["id"], name });
        }
      }
      if (rows.length < USER_PAGE_SIZE) return { users, truncated: false };
    }
    return { users, truncated: true };
  } catch {
    return undefined;
  }
}
