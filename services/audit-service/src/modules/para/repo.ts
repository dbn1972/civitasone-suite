import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditParas, auditDeptResponses, auditParaStatusHistory, type ParaRow, type ParaInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findParaById(id: string, tenantId: string): Promise<ParaRow | null> {
  const rows = await db.select().from(auditParas).where(and(eq(auditParas.id, id), eq(auditParas.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findParaByIdTx(tx: Writer, id: string, tenantId: string): Promise<ParaRow | null> {
  const rows = await (tx as typeof db).select().from(auditParas).where(and(eq(auditParas.id, id), eq(auditParas.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertPara(tx: Writer, row: ParaInsert): Promise<void> {
  await tx.insert(auditParas).values(row);
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected (0 = stale version / not found). */
export async function updateParaVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<ParaInsert>): Promise<number> {
  const res = await tx.update(auditParas)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(auditParas.id, id), eq(auditParas.tenantId, tenantId), eq(auditParas.version, expectedVersion)))
    .returning({ id: auditParas.id });
  return res.length;
}

export async function insertStatusHistory(tx: Writer, row: typeof auditParaStatusHistory.$inferInsert): Promise<void> {
  await tx.insert(auditParaStatusHistory).values(row);
}

export async function insertDeptResponse(tx: Writer, row: typeof auditDeptResponses.$inferInsert): Promise<void> {
  await tx.insert(auditDeptResponses).values(row);
}

export async function listParas(tenantId: string, status?: string, deptRef?: string, limit = 50, offset = 0): Promise<ParaRow[]> {
  const conditions = [eq(auditParas.tenantId, tenantId)];
  if (status) conditions.push(eq(auditParas.status, status));
  if (deptRef) conditions.push(eq(auditParas.deptRef, deptRef));
  return db.select().from(auditParas).where(and(...conditions)).limit(limit).offset(offset);
}

export async function listParasCount(tenantId: string, status?: string, deptRef?: string): Promise<number> {
  const conditions = [eq(auditParas.tenantId, tenantId)];
  if (status) conditions.push(eq(auditParas.status, status));
  if (deptRef) conditions.push(eq(auditParas.deptRef, deptRef));
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(auditParas).where(and(...conditions));
  return rows[0]?.count ?? 0;
}
