import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditPlans, auditPlanItems, type PlanRow, type PlanInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findPlanById(id: string): Promise<PlanRow | null> {
  const rows = await db.select().from(auditPlans).where(eq(auditPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findPlanByIdTx(tx: Writer, id: string): Promise<PlanRow | null> {
  const rows = await (tx as typeof db).select().from(auditPlans).where(eq(auditPlans.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertPlan(tx: Writer, row: PlanInsert): Promise<void> {
  await tx.insert(auditPlans).values(row);
}

export async function updatePlan(tx: Writer, id: string, patch: Partial<PlanInsert>): Promise<void> {
  await tx.update(auditPlans).set({ ...patch, updatedAt: new Date() }).where(eq(auditPlans.id, id));
}

export async function insertPlanItem(tx: Writer, row: typeof auditPlanItems.$inferInsert): Promise<void> {
  await tx.insert(auditPlanItems).values(row);
}
