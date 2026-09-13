import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { scimTokens, type ScimTokenRow, type ScimTokenInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * SEC-007 — lookup by secret hash, intentionally NOT tenant-scoped: the
 * whole point of this call is to discover which tenant a bearer token
 * belongs to before anything about the caller's tenant is known. See
 * migrations/0022_scim_per_tenant_tokens.sql for why scim.scim_tokens
 * deliberately carries no RLS policy (a FORCE-RLS tenant policy would make
 * this exact query always return zero rows, since no tenant GUC can be set
 * yet at this point in the request).
 */
export async function findBySecretHash(tx: Writer, secretHash: string): Promise<ScimTokenRow | null> {
  const rows = await tx.select().from(scimTokens).where(eq(scimTokens.secretHash, secretHash)).limit(1);
  return rows[0] ?? null;
}

export async function touchLastUsed(tx: Writer, id: string, when: Date): Promise<void> {
  await tx.update(scimTokens).set({ lastUsedAt: when }).where(eq(scimTokens.id, id));
}

export async function insert(tx: Writer, row: ScimTokenInsert): Promise<void> {
  await tx.insert(scimTokens).values(row);
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

/** Idempotent-ish revoke: only flips active -> revoked; returns rows affected (0 if already revoked/missing). */
export async function revoke(tenantId: string, id: string): Promise<number> {
  const now = new Date();
  const res = await db
    .update(scimTokens)
    .set({ status: "revoked", revokedAt: now, updatedAt: now })
    .where(and(eq(scimTokens.id, id), eq(scimTokens.tenantId, tenantId), eq(scimTokens.status, "active")))
    .returning({ id: scimTokens.id });
  return res.length;
}
