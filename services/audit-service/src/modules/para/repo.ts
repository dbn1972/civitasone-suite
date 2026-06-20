import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditParas, auditDeptResponses, auditParaStatusHistory, type ParaRow, type ParaInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findParaById(id: string): Promise<ParaRow | null> {
  const rows = await db.select().from(auditParas).where(eq(auditParas.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findParaByIdTx(tx: Writer, id: string): Promise<ParaRow | null> {
  const rows = await (tx as typeof db).select().from(auditParas).where(eq(auditParas.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertPara(tx: Writer, row: ParaInsert): Promise<void> {
  await tx.insert(auditParas).values(row);
}

export async function updatePara(tx: Writer, id: string, patch: Partial<ParaInsert>): Promise<void> {
  await tx.update(auditParas).set({ ...patch, updatedAt: new Date() }).where(eq(auditParas.id, id));
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
