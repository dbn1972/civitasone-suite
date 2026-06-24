import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementPos, procurementPoItems, type PoRow, type PoInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPoById(id: string, tenantId: string): Promise<PoRow | null> {
  const rows = await db.select().from(procurementPos)
    .where(and(eq(procurementPos.id, id), eq(procurementPos.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findPoItemsByPoId(poId: string, tenantId: string): Promise<(typeof procurementPoItems.$inferSelect)[]> {
  return db.select().from(procurementPoItems)
    .where(and(eq(procurementPoItems.poId, poId), eq(procurementPoItems.tenantId, tenantId)));
}

export async function findPoByIdTx(tx: Writer, id: string, tenantId: string): Promise<PoRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPos)
    .where(and(eq(procurementPos.id, id), eq(procurementPos.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listPosByTenant(tenantId: string, limit = 100, offset = 0): Promise<PoRow[]> {
  return db.select().from(procurementPos).where(eq(procurementPos.tenantId, tenantId)).limit(limit).offset(offset);
}

export async function insertPo(tx: Writer, row: PoInsert): Promise<void> {
  await tx.insert(procurementPos).values(row);
}

export async function updatePo(tx: Writer, id: string, patch: Partial<PoInsert>): Promise<void> {
  await tx.update(procurementPos).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPos.id, id));
}

/** Optimistic-locked update (#16): bumps version, fails if `expectedVersion` is stale. */
export async function updatePoVersioned(tx: Writer, id: string, expectedVersion: number, patch: Partial<PoInsert>): Promise<void> {
  const res = await (tx as typeof db).update(procurementPos)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(procurementPos.id, id), eq(procurementPos.version, expectedVersion)))
    .returning({ id: procurementPos.id });
  if (res.length === 0) {
    throw new Error(`OPTIMISTIC_LOCK_CONFLICT: po ${id} was modified concurrently (expected version ${expectedVersion})`);
  }
}

export async function insertPoItems(tx: Writer, items: (typeof procurementPoItems.$inferInsert)[]): Promise<void> {
  if (items.length) await tx.insert(procurementPoItems).values(items);
}
