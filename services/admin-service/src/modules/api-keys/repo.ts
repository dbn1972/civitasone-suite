import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { adminApiKeys, type ApiKeyRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listByTenant(tenantId: string, limit: number): Promise<ApiKeyRow[]> {
  return db.select().from(adminApiKeys)
    .where(eq(adminApiKeys.tenantId, tenantId))
    .limit(limit);
}

export async function insertKey(tx: Writer, row: typeof adminApiKeys.$inferInsert): Promise<void> {
  await tx.insert(adminApiKeys).values(row);
}

export async function findById(id: string, tenantId: string): Promise<ApiKeyRow | null> {
  const rows = await db.select().from(adminApiKeys)
    .where(and(eq(adminApiKeys.id, id), eq(adminApiKeys.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function revokeKey(id: string, tenantId: string, actorId: string): Promise<void> {
  await db.update(adminApiKeys)
    .set({ status: "revoked", updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(adminApiKeys.id, id), eq(adminApiKeys.tenantId, tenantId)));
}

// P1-5: rotate replaces the stored hash/prefix in place. The old secret stops
// working immediately; only the new raw key (returned once by the route) is valid.
export async function rotateKey(
  tx: Writer,
  id: string,
  tenantId: string,
  keyPrefix: string,
  keyHash: string,
  actorId: string,
): Promise<void> {
  await tx.update(adminApiKeys)
    .set({ keyPrefix, keyHash, status: "active", updatedAt: new Date(), updatedBy: actorId })
    .where(and(eq(adminApiKeys.id, id), eq(adminApiKeys.tenantId, tenantId)));
}
