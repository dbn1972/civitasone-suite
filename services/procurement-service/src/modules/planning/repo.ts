import { and, eq, desc, inArray, sql, type SQL } from "drizzle-orm";
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

export async function listPlansByTenant(
  tenantId: string,
  limit = 100,
  offset = 0,
  filter?: { department?: string | undefined; year?: number | undefined },
): Promise<PlanRow[]> {
  const conds: SQL[] = [eq(procurementPlans.tenantId, tenantId)];
  // GAP-PROCUREMENT-PLANNING-01: optional server-side department/year filter so
  // a department with several years of plans is not forced into one unpaginated
  // list. Both are exact-match equality (FY start year, canonical department).
  if (filter?.department) conds.push(eq(procurementPlans.department, filter.department));
  if (typeof filter?.year === "number") conds.push(eq(procurementPlans.planYear, filter.year));
  return db.transaction((tx) => tx.select().from(procurementPlans)
    .where(and(...conds))
    .orderBy(desc(procurementPlans.createdAt)).limit(limit).offset(offset));
}

/**
 * GAP-PROCUREMENT-PLANNING-02/04: per-plan line count for the list page's
 * "Items" column, as one grouped query over the plan ids (no N+1).
 */
export async function countLinesByPlanIds(tenantId: string, planIds: string[]): Promise<Map<string, number>> {
  if (planIds.length === 0) return new Map();
  const rows = await db.transaction((tx) => tx
    .select({
      planId: procurementPlanLines.planId,
      count: sql<number>`COUNT(*)`,
    })
    .from(procurementPlanLines)
    .where(and(
      eq(procurementPlanLines.tenantId, tenantId),
      inArray(procurementPlanLines.planId, planIds),
    ))
    .groupBy(procurementPlanLines.planId));
  return new Map(rows.map((r) => [r.planId, Number(r.count)]));
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
