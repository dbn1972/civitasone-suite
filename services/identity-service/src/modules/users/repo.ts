import { eq, and, or, ilike, inArray, count, asc, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { users, type UserRow, type UserInsert } from "./schema.js";
import type { UserView } from "./domain.js";

function toView(r: UserRow): UserView {
  return {
    id: r.id, tenantId: r.tenantId, email: r.email, name: r.name,
    empCode: r.empCode ?? null, status: r.status as UserView["status"],
    mfaEnabled: r.mfaEnabled, version: r.version,
  };
}

export async function findById(tenantId: string, id: string): Promise<UserView | null> {
  const rows = await scopedRead((tx) => tx.select().from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantId(tenantId: string, limit = 50, offset = 0): Promise<UserView[]> {
  const rows = await scopedRead((tx) => tx.select().from(users)
    .where(eq(users.tenantId, tenantId))
    .limit(limit).offset(offset));
  return rows.map(toView);
}

export type UserSearch = { q?: string | undefined; status?: UserView["status"] | undefined; limit: number; offset: number };
export type UserStatusCounts = Record<UserView["status"], number>;

/** Escape LIKE wildcards so a search for "100%" or "a_b" is literal. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * GAP-ADMIN-USERS-03: server-side directory search. Returns one page, the TOTAL
 * of the rows matching the filter, and per-status counts for the whole tenant
 * (so the stat tiles stay true however many users there are). Stable ORDER BY.
 */
export async function search(tenantId: string, f: UserSearch): Promise<{ rows: UserView[]; total: number; counts: UserStatusCounts }> {
  const term = f.q?.trim();
  const like = term ? `%${escapeLike(term)}%` : null;
  const match = and(
    eq(users.tenantId, tenantId),
    f.status ? eq(users.status, f.status) : undefined,
    like ? or(ilike(users.name, like), ilike(users.email, like), ilike(users.empCode, like)) : undefined,
  );
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(users).where(match)
      .orderBy(asc(users.name), asc(users.id)).limit(f.limit).offset(f.offset);
    const [{ n }] = await tx.select({ n: count() }).from(users).where(match) as [{ n: number }];
    const byStatus = await tx.select({ status: users.status, n: count() }).from(users)
      .where(eq(users.tenantId, tenantId)).groupBy(users.status);
    const counts: UserStatusCounts = { active: 0, suspended: 0, locked: 0, deactivated: 0 };
    for (const r of byStatus) if (r.status in counts) counts[r.status as UserView["status"]] = Number(r.n);
    return { rows: rows.map(toView), total: Number(n), counts };
  });
}

export type DirectoryEntry = { id: string; displayName: string };

/**
 * Shared user-directory lookup (GAP-WORKFLOW-INSTANCES-DETAIL-01 /
 * GAP-PROJECTS-DETAIL-MEMBERS-01). Tenant-scoped (RLS + explicit WHERE) and
 * returns ONLY {id, displayName} — never email/phone/empCode/status.
 *
 *   • byIds: the directory rows for exactly these ids (any status, since a
 *     workflow history row can reference a since-deactivated actor whose name
 *     must still render). Order is unspecified; callers map by id.
 *   • byQuery: a capped, name-ordered type-ahead over NAME ONLY (never email /
 *     empCode: any authenticated same-tenant caller can reach it, so matching
 *     those would let them enumerate addresses/codes by prefix), active users only — a search
 *     picker should surface people you can still assign work to.
 */
export async function directoryByIds(tenantId: string, ids: string[]): Promise<DirectoryEntry[]> {
  if (ids.length === 0) return [];
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
    return rows.map((r) => ({ id: r.id, displayName: r.name }));
  });
}

export async function directoryByQuery(tenantId: string, q: string, limit: number): Promise<DirectoryEntry[]> {
  const like = `%${escapeLike(q.trim())}%`;
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          eq(users.status, "active"),
          ilike(users.name, like),
        ),
      )
      .orderBy(asc(users.name), asc(users.id))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, displayName: r.name }));
  });
}

/** Of these ids, the ones that are ACTIVE users of the tenant. */
export async function activeAmong(tx: Writer, tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.id, ids)));
  return rows.map((r) => r.id);
}

/** Active users (id, name, email) among these ids, tenant-scoped: the recipients of tenant-admin notices. */
export async function activeContactsAmong(tenantId: string, ids: string[]): Promise<Array<{ id: string; name: string; email: string }>> {
  if (ids.length === 0) return [];
  return scopedRead(async (tx) => {
    const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, "active"), inArray(users.id, ids)))
      .orderBy(asc(users.name), asc(users.id));
    return rows;
  });
}

/** Serialise concurrent status changes of one tenant's admins for the rest of this transaction. */
export async function lockTenantAdmins(tx: Writer, tenantId: string): Promise<void> {
  await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(sql`select pg_advisory_xact_lock(hashtext(${"tenant-admins:" + tenantId}))`);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: UserInsert): Promise<void> {
  await tx.insert(users).values(row);
}

export async function update(tx: Writer, tenantId: string, id: string, patch: Partial<UserInsert>): Promise<void> {
  await tx.update(users).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
}

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<UserView | null> {
  const rows = await tx.select().from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export { toView };
