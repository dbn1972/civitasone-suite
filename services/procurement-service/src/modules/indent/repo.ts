import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { procurementIndents, procurementIndentItems, type IndentRow, type IndentInsert, type IndentItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function findIndentById(id: string): Promise<IndentRow | null> {
  const rows = await db.select().from(procurementIndents).where(eq(procurementIndents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findIndentItemsByIndentId(indentId: string): Promise<(typeof procurementIndentItems.$inferSelect)[]> {
  return db.select().from(procurementIndentItems).where(eq(procurementIndentItems.indentId, indentId));
}

export async function findIndentsByTenant(tenantId: string, limit = 100, offset = 0): Promise<IndentRow[]> {
  return db.select().from(procurementIndents).where(eq(procurementIndents.tenantId, tenantId)).limit(limit).offset(offset);
}

export async function findIndentByIdTx(tx: Writer, id: string): Promise<IndentRow | null> {
  const rows = await (tx as typeof db).select().from(procurementIndents).where(eq(procurementIndents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertIndent(tx: Writer, row: IndentInsert): Promise<void> {
  await tx.insert(procurementIndents).values(row);
}

export async function updateIndent(tx: Writer, id: string, patch: Partial<IndentInsert>): Promise<void> {
  await tx.update(procurementIndents).set({ ...patch, updatedAt: new Date() }).where(eq(procurementIndents.id, id));
}

export async function insertIndentItems(tx: Writer, items: IndentItemInsert[]): Promise<void> {
  if (items.length) await tx.insert(procurementIndentItems).values(items);
}

export async function findTenderRequiredIndents(tenantId: string, limit = 50): Promise<IndentRow[]> {
  return db.select().from(procurementIndents)
    .where(and(eq(procurementIndents.tenantId, tenantId), eq(procurementIndents.status, "tender_required")))
    .orderBy(desc(procurementIndents.createdAt))
    .limit(limit);
}
