import { eq, and, desc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { scimTokens, type ScimTokenRow, type ScimTokenInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * SEC-007 — lookup by secret hash, intentionally NOT tenant-scoped: the
 * whole point of this call is to discover which tenant a bearer token
 * belongs to before anything about the caller's tenant is known. See
 * migrations/0022_scim_per_tenant_tokens.sql for why a normal FORCE-RLS
 * tenant policy would make this exact query always return zero rows (no
 * tenant GUC can be set yet at this point in the request), and
 * migrations/0024_sec025_scim_tokens_rls.sql (SEC-025) for the resulting
 * hybrid: this table DOES carry FORCE ROW LEVEL SECURITY as of that
 * migration, but its SELECT policy is deliberately permissive (`USING
 * (true)`) so this lookup keeps working unauthenticated by tenant, exactly
 * as before — only INSERT/UPDATE/DELETE are tenant-scoped now.
 */
export async function findBySecretHash(tx: Writer, secretHash: string): Promise<ScimTokenRow | null> {
  const rows = await tx.select().from(scimTokens).where(eq(scimTokens.secretHash, secretHash)).limit(1);
  return rows[0] ?? null;
}

/**
 * SEC-025: scim.scim_tokens's UPDATE policy (migration 0024) now requires
 * tenant_id = current_tenant_id(), so this write runs inside
 * runWithTenant(tenantId, () => db.transaction(...)) to set that GUC —
 * without it, the UPDATE would silently match zero rows under FORCE RLS.
 * Wrapped HERE (not at each call site) so routes.ts never needs to know
 * about db.transaction directly — see f3-b2-mfa-scim-cqrs.test.ts's "scim
 * routes have zero sync drizzle writes" guard, which greps routes.ts's own
 * source text for db.(insert|update|delete|execute|transaction).
 */
export async function touchLastUsed(tenantId: string, id: string, when: Date): Promise<void> {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.update(scimTokens).set({ lastUsedAt: when }).where(eq(scimTokens.id, id))),
  );
}

/**
 * SEC-025: INSERT policy (migration 0024) requires tenant_id =
 * current_tenant_id() — wrapped internally for the same reason as
 * touchLastUsed above. Tenant comes from `row.tenantId` (the row IS the
 * source of truth for which tenant it's being bound to).
 */
export async function insert(row: ScimTokenInsert): Promise<void> {
  await runWithTenant(row.tenantId, () => db.transaction((tx) => tx.insert(scimTokens).values(row)));
}

/** Tenant-scoped in application code (belt-and-suspenders — see repo note above). */
export async function listByTenant(tenantId: string): Promise<ScimTokenRow[]> {
  return db
    .select()
    .from(scimTokens)
    .where(eq(scimTokens.tenantId, tenantId))
    .orderBy(desc(scimTokens.createdAt));
}

export async function findById(tenantId: string, id: string): Promise<ScimTokenRow | null> {
  const rows = await db
    .select()
    .from(scimTokens)
    .where(and(eq(scimTokens.id, id), eq(scimTokens.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Idempotent-ish revoke: only flips active -> revoked; returns rows affected
 * (0 if already revoked/missing).
 *
 * SEC-025: UPDATE policy (migration 0024) requires tenant_id =
 * current_tenant_id() — wrapped internally for the same reason as
 * touchLastUsed/insert above; the WHERE clause below still (deliberately)
 * also filters by tenant_id in application code, belt-and-suspenders.
 */
export async function revoke(tenantId: string, id: string): Promise<number> {
  const now = new Date();
  const res = await runWithTenant(tenantId, () =>
    db.transaction((tx) =>
      tx
        .update(scimTokens)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(and(eq(scimTokens.id, id), eq(scimTokens.tenantId, tenantId), eq(scimTokens.status, "active")))
        .returning({ id: scimTokens.id }),
    ),
  );
  return res.length;
}
