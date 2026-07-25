import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementPoAmendments, procurementPoMilestones,
  type PoAmendmentRow, type PoAmendmentInsert,
  type PoMilestoneRow, type PoMilestoneInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── Amendments ────────────────────────────────────────────────────
export async function insertAmendment(tx: Writer, row: PoAmendmentInsert): Promise<void> {
  await tx.insert(procurementPoAmendments).values(row);
}

export async function updateAmendment(tx: Writer, id: string, patch: Partial<PoAmendmentInsert>): Promise<void> {
  await tx.update(procurementPoAmendments).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPoAmendments.id, id));
}

export async function findAmendmentByIdTx(tx: Writer, id: string, tenantId: string): Promise<PoAmendmentRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPoAmendments)
    .where(and(eq(procurementPoAmendments.id, id), eq(procurementPoAmendments.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function maxAmendmentNoTx(tx: Writer, poId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).select({ n: sql<number>`COALESCE(MAX(${procurementPoAmendments.amendmentNo}), 0)` })
    .from(procurementPoAmendments)
    .where(and(eq(procurementPoAmendments.poId, poId), eq(procurementPoAmendments.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}

export async function listAmendmentsByPo(poId: string, tenantId: string): Promise<PoAmendmentRow[]> {
  return db.transaction((tx) => tx.select().from(procurementPoAmendments)
    .where(and(eq(procurementPoAmendments.poId, poId), eq(procurementPoAmendments.tenantId, tenantId)))
    .orderBy(procurementPoAmendments.amendmentNo));
}

// ── Milestones ────────────────────────────────────────────────────
export async function insertMilestone(tx: Writer, row: PoMilestoneInsert): Promise<void> {
  await tx.insert(procurementPoMilestones).values(row);
}

export async function updateMilestone(tx: Writer, id: string, patch: Partial<PoMilestoneInsert>): Promise<void> {
  await tx.update(procurementPoMilestones).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPoMilestones.id, id));
}

export async function findMilestoneByIdTx(tx: Writer, id: string, tenantId: string): Promise<PoMilestoneRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPoMilestones)
    .where(and(eq(procurementPoMilestones.id, id), eq(procurementPoMilestones.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function maxMilestoneNoTx(tx: Writer, poId: string, tenantId: string): Promise<number> {
  const rows = await (tx as typeof db).select({ n: sql<number>`COALESCE(MAX(${procurementPoMilestones.milestoneNo}), 0)` })
    .from(procurementPoMilestones)
    .where(and(eq(procurementPoMilestones.poId, poId), eq(procurementPoMilestones.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}

export async function listMilestonesByPoTx(tx: Writer, poId: string, tenantId: string): Promise<PoMilestoneRow[]> {
  return (tx as typeof db).select().from(procurementPoMilestones)
    .where(and(eq(procurementPoMilestones.poId, poId), eq(procurementPoMilestones.tenantId, tenantId)));
}

export async function listMilestonesByPo(poId: string, tenantId: string): Promise<PoMilestoneRow[]> {
  return db.transaction((tx) => listMilestonesByPoTx(tx, poId, tenantId));
}
