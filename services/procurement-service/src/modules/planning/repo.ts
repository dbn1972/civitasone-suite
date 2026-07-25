import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementPlans, procurementPlanLines,
  type PlanRow, type PlanInsert, type PlanLineRow, type PlanLineInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function findPlanById(id: string, tenantId: string): Promise<PlanRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(procurementPlans)
    .where(and(eq(procurementPlans.id, id), eq(procurementPlans.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function findPlanByIdTx(tx: Writer, id: string, tenantId: string): Promise<PlanRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPlans)
    .where(and(eq(procurementPlans.id, id), eq(procurementPlans.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findPlanLines(planId: string, tenantId: string): Promise<PlanLineRow[]> {
  return db.transaction((tx) => tx.select().from(procurementPlanLines)
    .where(and(eq(procurementPlanLines.planId, planId), eq(procurementPlanLines.tenantId, tenantId))));
}

export async function findPlanLineByIdTx(tx: Writer, lineId: string, tenantId: string): Promise<PlanLineRow | null> {
  const rows = await (tx as typeof db).select().from(procurementPlanLines)
    .where(and(eq(procurementPlanLines.id, lineId), eq(procurementPlanLines.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listPlansByTenant(tenantId: string, limit = 100, offset = 0): Promise<PlanRow[]> {
  return db.transaction((tx) => tx.select().from(procurementPlans)
    .where(eq(procurementPlans.tenantId, tenantId))
    .orderBy(desc(procurementPlans.createdAt)).limit(limit).offset(offset));
}

export async function insertPlan(tx: Writer, row: PlanInsert): Promise<void> {
  await tx.insert(procurementPlans).values(row);
}

export async function updatePlan(tx: Writer, id: string, patch: Partial<PlanInsert>): Promise<void> {
  await tx.update(procurementPlans).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPlans.id, id));
}

export async function insertPlanLines(tx: Writer, rows: PlanLineInsert[]): Promise<void> {
  if (rows.length) await tx.insert(procurementPlanLines).values(rows);
}

export async function updatePlanLine(tx: Writer, id: string, patch: Partial<PlanLineInsert>): Promise<void> {
  await tx.update(procurementPlanLines).set({ ...patch, updatedAt: new Date() }).where(eq(procurementPlanLines.id, id));
}
