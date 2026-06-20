import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementGrns, procurementGrnItems, procurementInspections, type GrnRow, type GrnInsert, type GrnItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findGrnById(id: string): Promise<GrnRow | null> {
  const rows = await db.select().from(procurementGrns).where(eq(procurementGrns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findGrnByIdTx(tx: Writer, id: string): Promise<GrnRow | null> {
  const rows = await (tx as typeof db).select().from(procurementGrns).where(eq(procurementGrns.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findGrnItemsByGrnTx(tx: Writer, grnId: string): Promise<(typeof procurementGrnItems.$inferSelect)[]> {
  return (tx as typeof db).select().from(procurementGrnItems).where(eq(procurementGrnItems.grnId, grnId));
}

export async function findInspectionByGrnTx(tx: Writer, grnId: string): Promise<(typeof procurementInspections.$inferSelect) | null> {
  const rows = await (tx as typeof db).select().from(procurementInspections).where(eq(procurementInspections.grnId, grnId)).limit(1);
  return rows[0] ?? null;
}

export async function insertGrn(tx: Writer, row: GrnInsert): Promise<void> {
  await tx.insert(procurementGrns).values(row);
}

export async function updateGrn(tx: Writer, id: string, patch: Partial<GrnInsert>): Promise<void> {
  await tx.update(procurementGrns).set({ ...patch, updatedAt: new Date() }).where(eq(procurementGrns.id, id));
}

export async function insertGrnItems(tx: Writer, items: GrnItemInsert[]): Promise<void> {
  if (items.length) await tx.insert(procurementGrnItems).values(items);
}

export async function insertInspection(tx: Writer, row: typeof procurementInspections.$inferInsert): Promise<void> {
  await tx.insert(procurementInspections).values(row);
}
