import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditPlans, auditPlanItems, type PlanRow, type PlanInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPlanById(id: string, tenantId: string): Promise<PlanRow | null> {
  const rows = await db.select().from(auditPlans).where(and(eq(auditPlans.id, id), eq(auditPlans.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findPlanByIdTx(tx: Writer, id: string, tenantId: string): Promise<PlanRow | null> {
  const rows = await (tx as typeof db).select().from(auditPlans).where(and(eq(auditPlans.id, id), eq(auditPlans.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertPlan(tx: Writer, row: PlanInsert): Promise<void> {
  await tx.insert(auditPlans).values(row);
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected (0 = stale version / not found). */
export async function updatePlanVersioned(tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<PlanInsert>): Promise<number> {
  const res = await tx.update(auditPlans)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(auditPlans.id, id), eq(auditPlans.tenantId, tenantId), eq(auditPlans.version, expectedVersion)))
    .returning({ id: auditPlans.id });
  return res.length;
}

export async function insertPlanItem(tx: Writer, row: typeof auditPlanItems.$inferInsert): Promise<void> {
  await tx.insert(auditPlanItems).values(row);
}

export async function listPlanItemsByTenant(tenantId: string, limit: number) {
  return db.select().from(auditPlanItems).where(eq(auditPlanItems.tenantId, tenantId)).limit(limit);
}
