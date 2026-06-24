import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditPendingRegister, auditChecklists, type PendingRegisterRow, type ChecklistRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPendingRegister(tx: Writer, row: typeof auditPendingRegister.$inferInsert): Promise<void> {
  await tx.insert(auditPendingRegister).values(row);
}

export async function listPendingRegister(tenantId: string, status = "pending"): Promise<PendingRegisterRow[]> {
  return db.select().from(auditPendingRegister).where(
    and(eq(auditPendingRegister.tenantId, tenantId), eq(auditPendingRegister.status, status)),
  );
}

// --- P0-4: persistent, tenant-scoped compliance checklists ---

export async function insertChecklist(tx: Writer, row: typeof auditChecklists.$inferInsert): Promise<void> {
  await tx.insert(auditChecklists).values(row);
}

export async function findChecklistByIdTx(tx: Writer, id: string, tenantId: string): Promise<ChecklistRow | null> {
  const rows = await (tx as typeof db).select().from(auditChecklists)
    .where(and(eq(auditChecklists.id, id), eq(auditChecklists.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listChecklists(tenantId: string, limit: number, offset: number): Promise<{ items: ChecklistRow[]; total: number }> {
  const items = await db.select().from(auditChecklists)
    .where(eq(auditChecklists.tenantId, tenantId))
    .orderBy(desc(auditChecklists.createdAt))
    .limit(limit).offset(offset);
  const totalRows = await db.select({ count: sql<number>`count(*)::int` }).from(auditChecklists)
    .where(eq(auditChecklists.tenantId, tenantId));
  return { items, total: totalRows[0]?.count ?? 0 };
}

/** Optimistic-locked completion. Returns rows affected (0 = not found / already completed / stale). */
export async function completeChecklistVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, completedBy: string): Promise<number> {
  const res = await tx.update(auditChecklists)
    .set({ completed: true, completedBy, completedAt: new Date(), updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(auditChecklists.id, id),
      eq(auditChecklists.tenantId, tenantId),
      eq(auditChecklists.version, expectedVersion),
      eq(auditChecklists.completed, false),
    ))
    .returning({ id: auditChecklists.id });
  return res.length;
}
