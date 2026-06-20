import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementPos, procurementPoItems, type PoRow, type PoInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPoById(id: string): Promise<PoRow | null> {
  const rows = await db.select().from(procurementPos).where(eq(procurementPos.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findPoByIdTx(tx: Writer, id: string): Promise<PoRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPos).where(eq(procurementPos.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listPosByTenant(tenantId: string, limit = 100): Promise<PoRow[]> {
  return db.select().from(procurementPos).where(eq(procurementPos.tenantId, tenantId)).limit(limit);
}

export async function insertPo(tx: Writer, row: PoInsert): Promise<void> {
  await tx.insert(procurementPos).values(row);
}

export async function updatePo(tx: Writer, id: string, patch: Partial<PoInsert>): Promise<void> {
  await tx.update(procurementPos).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPos.id, id));
}

export async function insertPoItems(tx: Writer, items: (typeof procurementPoItems.$inferInsert)[]): Promise<void> {
  if (items.length) await tx.insert(procurementPoItems).values(items);
}
