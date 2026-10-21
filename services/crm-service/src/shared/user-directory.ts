/**
 * Read-only directory of a tenant's staff, for CRM display names and pickers.
 *
 * crm-service stores only opaque user ids (owner, assignee, actor, creator).
 * Showing a UUID to an officer is useless, and the web used to resolve names
 * itself through identity-service's admin-only `identity/users` listing, so any
 * CRM user who was not also a tenant admin saw nothing. These helpers resolve
 * names server-side over the established `x-internal` + `x-service-secret` +
 * `x-tenant-id` service-to-service path, so every CRM role that may see a record
 * also sees who touched it.
 *
 * Only `{ id, name }` crosses the boundary (no email, status or MFA state), and
 * the lookup is tenant-scoped by the callee: an id from another tenant simply
 * does not resolve.
 *
 * Display enrichment is FAIL-OPEN: an unreachable identity-service yields an
 * empty map and the caller renders "name unavailable", never a raw id and never
 * a broken page. The pickers are the opposite - they return `undefined` when
 * the directory cannot be read so the route can answer 503 rather than present
 * an empty list as fact.
 */

const IDENTITY_URL = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const POLICY_URL = (process.env.POLICY_SERVICE_URL ?? "http://127.0.0.1:3003").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.CROSS_SERVICE_TIMEOUT_MS ?? 5000);
const TTL_MS = 60_000;

export interface DirectoryUser {
  id: string;
  name: string;
}

export interface DirectoryRole {
  /** The value stored on a rule (`recipientRole`) - the role's name. */
  key: string;
  label: string;
}

const userCache = new Map<string, { at: number; users: DirectoryUser[] }>();
const roleCache = new Map<string, { at: number; roles: DirectoryRole[] }>();

function internalHeaders(tenantId: string): Record<string, string> {
  return {
    "x-internal": "1",
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-tenant-id": tenantId,
    "x-internal-caller": "crm-service",
  };
}

/** All of the tenant's users as `{ id, name }`, or `undefined` when unreadable. */
export async function listDirectoryUsers(tenantId: string): Promise<DirectoryUser[] | undefined> {
  const hit = userCache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.users;
  try {
    const res = await fetch(`${IDENTITY_URL}/identity/internal/user-summaries`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const rows = (await res.json()) as unknown;
    const users: DirectoryUser[] = [];
    for (const r of Array.isArray(rows) ? (rows as Array<{ id?: unknown; name?: unknown }>) : []) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) {
        users.push({ id: r.id, name: r.name.trim() });
      }
    }
    users.sort((a, b) => a.name.localeCompare(b.name, "en"));
    userCache.set(tenantId, { at: Date.now(), users });
    return users;
  } catch {
    return undefined;
  }
}

/** Display names for the given user ids; ids that cannot be resolved are absent. */
export async function resolveUserNames(
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0));
  if (wanted.size === 0) return new Map();
  const users = await listDirectoryUsers(tenantId);
  const out = new Map<string, string>();
  for (const u of users ?? []) if (wanted.has(u.id)) out.set(u.id, u.name);
  return out;
}

/**
 * The tenant's active roles, from policy-service (the source of truth for role
 * definitions). `undefined` when policy-service cannot be read.
 */
export async function listDirectoryRoles(tenantId: string): Promise<DirectoryRole[] | undefined> {
  const hit = roleCache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.roles;
  try {
    const res = await fetch(`${POLICY_URL}/policy/roles`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body) ? body : (body as { data?: unknown })?.data;
    const roles: DirectoryRole[] = [];
    for (const r of Array.isArray(list) ? (list as Array<{ name?: unknown; status?: unknown }>) : []) {
      if (typeof r.name !== "string" || !r.name.trim()) continue;
      if (typeof r.status === "string" && r.status !== "active") continue;
      roles.push({ key: r.name.trim(), label: r.name.trim() });
    }
    roles.sort((a, b) => a.label.localeCompare(b.label, "en"));
    roleCache.set(tenantId, { at: Date.now(), roles });
    return roles;
  } catch {
    return undefined;
  }
}

/** Test hook: drop the in-process caches. */
export function clearDirectoryCache(): void {
  userCache.clear();
  roleCache.clear();
}
