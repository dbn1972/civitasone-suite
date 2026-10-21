/**
 * The ONE read-only directory of a tenant's staff for crm-service: display names
 * for user ids, the user and role pickers, and nothing else.
 *
 * crm-service stores only opaque user ids (owner, assignee, actor, creator) and
 * neither owns users (identity-service) nor roles (policy-service). Those services'
 * own list endpoints are gated to platform/tenant admins, so a CRM user who was not
 * also a tenant admin saw raw ids and empty pickers. This module asks the owning
 * services server-side over the established `x-internal` + `x-service-secret` +
 * `x-tenant-id` service-to-service path, scoped to the CALLER's verified tenant,
 * and hands the rest of crm-service only `{ id, name }` / `{ key, label }`.
 * (Before this module there were four parallel clients with four caches; do not add
 * a fifth - extend this one.)
 *
 * Three datasets, one cache primitive per tenant each:
 *
 *  1. NAMES - `resolveUserNames`. EVERY user of the tenant, deactivated ones included
 *     (a record last changed by someone who has since left must still say who), from
 *     identity-service's minimal `/identity/internal/user-summaries` (`{ id, name }`,
 *     no email/status/MFA state; at most 2000 users). FAIL-OPEN display enrichment:
 *     any failure yields an empty map and the caller renders "name unavailable", never
 *     a raw id and never a broken page. A success is cached for 60s; a FAILURE is
 *     negative-cached for 10s so a hot read (the agent roster pickers fire one per
 *     keystroke) does not wait out the identity timeout on every request while identity
 *     is down. Concurrent callers share one in-flight request.
 *
 *  2. PICKER USERS - `listDirectoryUsers`. ACTIVE users only (so nobody deactivated is
 *     offered as an assignee or escalation target), from `/identity/users`, id + display
 *     name only. Read in pages; `truncated` is true when the tenant has more users than
 *     were read, in which case absence from the list proves nothing (use
 *     identity-client's `isActiveTenantUser` for an exact check). FAIL-CLOSED: `undefined`
 *     when the answer could not be obtained, so a route answers 503 rather than present an
 *     empty list as fact. Failures are never cached.
 *
 *     `searchDirectoryUsers` is the way past that bound: a server-side NAME search through to
 *     identity-service's shared directory (`/identity/users/directory?q=`: active users, matched
 *     on name only so email / employee code can never be probed, id + display name back, at most
 *     USER_SEARCH_LIMIT rows). A picker that is `truncated` says so and searches instead of silently
 *     omitting people. Same fail-closed contract; never cached (a type-ahead must see the
 *     directory as it is).
 *
 *  3. PICKER ROLES - `listDirectoryRoles`. The tenant's ACTIVE roles from policy-service
 *     (`{ key, label }`; the key is the role name an escalation rule stores). Same
 *     fail-closed contract as the users.
 *
 * Pass `{ fresh: true }` to the picker functions to skip the 60s cache read (the answer
 * is still cached): used where a stale answer would reject or accept a recipient wrongly.
 */

const identityUrl = (): string => (process.env.IDENTITY_SERVICE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
const policyUrl = (): string => (process.env.POLICY_SERVICE_URL ?? "http://127.0.0.1:3003").replace(/\/$/, "");
/** Picker reads: the caller needs a definite answer, so wait longer. */
const timeoutMs = (): number => Number(process.env.CROSS_SERVICE_TIMEOUT_MS ?? 5000);
/** Names are display decoration, so a slow identity must not stall the read for long. */
const NAME_TIMEOUT_MS = 2_000;
const TTL_MS = 60_000;
/** How long a failed NAMES lookup is remembered. Short, so names return soon after recovery. */
const NAME_FAILURE_TTL_MS = 10_000;
/** identity-service caps a page at 200 (tenantIdQuery); the pickers read a bounded number of pages. */
const USER_PAGE_SIZE = 200;
const USER_MAX_PAGES = 5;
/** identity-service's directory type-ahead returns at most 20 rows and needs at least 2 characters. */
export const USER_SEARCH_LIMIT = 20;
export const USER_SEARCH_MIN_CHARS = 2;

export interface DirectoryUser {
  id: string;
  name: string;
}

export interface DirectoryRole {
  /** The value stored on a rule (`recipientRole`) - the role's name. */
  key: string;
  label: string;
}

export interface DirectoryUserList {
  users: DirectoryUser[];
  /** True = more users exist than were read, so absence from `users` proves nothing. */
  truncated: boolean;
}

interface ReadOptions {
  /** Skip the cache read; the fresh answer still refreshes the cache. */
  fresh?: boolean;
}

function internalHeaders(tenantId: string): Record<string, string> {
  return {
    "x-internal": "1",
    "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
    "x-tenant-id": tenantId,
    "x-internal-caller": "crm-service",
  };
}

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

// ── 1. Names (fail-open, negative-cached) ─────────────────────────────────────

/** A failure is stored as an empty `names` map with the short NAME_FAILURE_TTL_MS `ttl`. */
const nameCache = new Map<string, { at: number; ttl: number; names: Map<string, string> }>();
/** In-flight lookups, so concurrent requests during a slow/hanging call share one fetch. */
const inflightNames = new Map<string, Promise<Map<string, string>>>();

function rememberNames(tenantId: string, names: Map<string, string>, ttl: number): Map<string, string> {
  nameCache.set(tenantId, { at: Date.now(), ttl, names });
  return names;
}

async function fetchTenantNames(tenantId: string): Promise<Map<string, string>> {
  try {
    const res = await fetch(`${identityUrl()}/identity/internal/user-summaries`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(NAME_TIMEOUT_MS),
    });
    if (!res.ok) return rememberNames(tenantId, new Map(), NAME_FAILURE_TTL_MS);
    const rows = (await res.json()) as unknown;
    const names = new Map<string, string>();
    for (const r of Array.isArray(rows) ? (rows as Array<{ id?: unknown; name?: unknown }>) : []) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) names.set(r.id, r.name.trim());
    }
    return rememberNames(tenantId, names, TTL_MS);
  } catch {
    return rememberNames(tenantId, new Map(), NAME_FAILURE_TTL_MS);
  }
}

async function loadTenantNames(tenantId: string): Promise<Map<string, string>> {
  const hit = nameCache.get(tenantId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.names;
  const pending = inflightNames.get(tenantId);
  if (pending) return pending;
  const p = fetchTenantNames(tenantId).finally(() => inflightNames.delete(tenantId));
  inflightNames.set(tenantId, p);
  return p;
}

/**
 * Display names for the given user ids; ids that cannot be resolved are absent, so the
 * caller omits the name (never substitutes the raw id). Never throws, never fails the
 * read it decorates. Ids that belong to another tenant simply do not resolve (the
 * callee scopes the list by x-tenant-id).
 */
export async function resolveUserNames(
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter((i): i is string => typeof i === "string" && i.length > 0));
  if (wanted.size === 0) return new Map();
  const all = await loadTenantNames(tenantId);
  const out = new Map<string, string>();
  for (const id of wanted) {
    const n = all.get(id);
    if (n) out.set(id, n);
  }
  return out;
}

// ── 2. Picker users (fail-closed, active only) ────────────────────────────────

const userCache = new Map<string, { at: number; list: DirectoryUserList }>();
const roleCache = new Map<string, { at: number; roles: DirectoryRole[] }>();

/**
 * The tenant's ACTIVE users as `{ id, name }` (a user with no display name is listed by
 * id, so the picker still offers them), sorted by name, or `undefined` when unreadable.
 * Bounded to USER_MAX_PAGES pages of USER_PAGE_SIZE; see `DirectoryUserList.truncated`.
 */
export async function listDirectoryUsers(tenantId: string, opts: ReadOptions = {}): Promise<DirectoryUserList | undefined> {
  const hit = userCache.get(tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const users: DirectoryUser[] = [];
  let truncated = true;
  try {
    for (let page = 0; page < USER_MAX_PAGES; page++) {
      const res = await fetch(
        `${identityUrl()}/identity/users?limit=${USER_PAGE_SIZE}&offset=${page * USER_PAGE_SIZE}`,
        { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(timeoutMs()) },
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
      if (rows.length < USER_PAGE_SIZE) {
        truncated = false;
        break;
      }
    }
  } catch {
    return undefined;
  }
  users.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const list: DirectoryUserList = { users, truncated };
  userCache.set(tenantId, { at: Date.now(), list });
  return list;
}

/**
 * The tenant's ACTIVE users whose NAME contains `q` (case-insensitive), as `{ id, name }` sorted by
 * name, or `undefined` when identity cannot be read (fail-closed, like {@link listDirectoryUsers}).
 * Capped at USER_SEARCH_LIMIT: `truncated` is true when the cap was reached, i.e. more people may
 * match and the caller should narrow the query. `q` must already be trimmed and at least
 * USER_SEARCH_MIN_CHARS long (the route validates it).
 */
export async function searchDirectoryUsers(tenantId: string, q: string): Promise<DirectoryUserList | undefined> {
  try {
    const res = await fetch(
      `${identityUrl()}/identity/users/directory?q=${encodeURIComponent(q)}&limit=${USER_SEARCH_LIMIT}`,
      { headers: internalHeaders(tenantId), signal: AbortSignal.timeout(timeoutMs()) },
    );
    if (!res.ok) return undefined;
    const rows = rowsOf(await res.json());
    if (!rows) return undefined;
    const users: DirectoryUser[] = [];
    for (const r of rows) {
      if (typeof r["id"] !== "string") continue;
      // identity's directory calls the display name `displayName`; tolerate `name` too.
      const raw = typeof r["displayName"] === "string" ? r["displayName"] : r["name"];
      users.push({ id: r["id"], name: typeof raw === "string" && raw.trim() ? raw.trim() : r["id"] });
    }
    users.sort((a, b) => a.name.localeCompare(b.name, "en"));
    return { users, truncated: rows.length >= USER_SEARCH_LIMIT };
  } catch {
    return undefined;
  }
}

// ── 3. Picker roles (fail-closed, active only) ────────────────────────────────

/**
 * The tenant's active roles, from policy-service (the source of truth for role
 * definitions), sorted by label. `undefined` when policy-service cannot be read.
 */
export async function listDirectoryRoles(tenantId: string, opts: ReadOptions = {}): Promise<DirectoryRole[] | undefined> {
  const hit = roleCache.get(tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.roles;
  try {
    const res = await fetch(`${policyUrl()}/policy/roles`, {
      headers: internalHeaders(tenantId),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!res.ok) return undefined;
    const rows = rowsOf(await res.json());
    if (!rows) return undefined;
    const roles: DirectoryRole[] = [];
    for (const r of rows) {
      if (typeof r["name"] !== "string" || !r["name"].trim()) continue;
      if (typeof r["status"] === "string" && r["status"] !== "active") continue;
      roles.push({ key: r["name"].trim(), label: r["name"].trim() });
    }
    roles.sort((a, b) => a.label.localeCompare(b.label, "en"));
    roleCache.set(tenantId, { at: Date.now(), roles });
    return roles;
  } catch {
    return undefined;
  }
}

/** Test hook: drop every in-process cache (and any in-flight lookup). */
export function clearDirectoryCache(): void {
  nameCache.clear();
  inflightNames.clear();
  userCache.clear();
  roleCache.clear();
}
