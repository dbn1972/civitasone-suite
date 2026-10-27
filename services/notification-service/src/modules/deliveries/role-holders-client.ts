/**
 * Role-holder lookup over HTTP (notify-roles): identity-service owns users and role assignments, so
 * "who holds role X" is answered by its internal /identity/internal/role-holders route (ids only).
 *
 * Unlike the CRM consent lookup this FAILS LOUDLY: an unreachable identity-service is an error the
 * queue retries, never an empty audience. Silently resolving to "nobody" would drop a security or
 * contract alert without a trace.
 */
import type { DeskScope } from "./role-recipients.js";

export interface RoleHolder {
  userId: string;
  tenantId: string;
}

export interface RoleHolderQuery {
  scope: DeskScope;
  roles: readonly string[];
  tenantId: string;
  correlationId: string;
  /** Stop paging once more than this many have been read (the caller truncates and audits). */
  max: number;
}

export type RoleHolderLookup = (q: RoleHolderQuery) => Promise<{ holders: RoleHolder[]; truncated: boolean }>;

const PAGE = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RoleHolderLookupError extends Error {}

export const fetchRoleHolders: RoleHolderLookup = async (q) => {
  const base = (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!secret) throw new RoleHolderLookupError("INTERNAL_SERVICE_SECRET is not set: role holders cannot be resolved");
  const timeout = Number(process.env.IDENTITY_LOOKUP_TIMEOUT_MS ?? 5000);

  const seen = new Set<string>();
  const holders: RoleHolder[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const params = new URLSearchParams({ scope: q.scope, limit: String(PAGE) });
    if (q.scope !== "tenant_all") params.set("roles", q.roles.join(","));
    if (after) params.set("after", after);
    let res: Response;
    try {
      res = await fetch(`${base}/identity/internal/role-holders?${params.toString()}`, {
        headers: {
          "x-internal": "1", "x-service-secret": secret, "x-internal-caller": "notification-service",
          "x-tenant-id": q.tenantId, "x-correlation-id": q.correlationId,
        },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new RoleHolderLookupError("identity-service unreachable while resolving role holders");
    }
    if (!res.ok) throw new RoleHolderLookupError(`identity-service role-holders lookup failed (${res.status})`);
    const body = (await res.json()) as { data?: unknown; nextCursor?: unknown };
    if (!Array.isArray(body.data)) throw new RoleHolderLookupError("identity-service role-holders response malformed");
    for (const row of body.data as Array<Record<string, unknown>>) {
      const userId = String(row.userId ?? ""), tenantId = String(row.tenantId ?? "");
      if (!UUID_RE.test(userId) || !UUID_RE.test(tenantId) || seen.has(userId)) continue;
      seen.add(userId);
      holders.push({ userId, tenantId });
      if (holders.length > q.max) return { holders: holders.slice(0, q.max), truncated: true };
    }
    if (typeof body.nextCursor !== "string" || !body.nextCursor) return { holders, truncated: false };
    after = body.nextCursor;
  }
  return { holders: holders.slice(0, q.max), truncated: true };
};
