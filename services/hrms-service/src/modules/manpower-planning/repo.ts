import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  manpowerPlans, manpowerPlanRoster, manpowerRequisitions,
  type ManpowerPlanRow, type ManpowerPlanInsert, type PlanRosterRow, type RequisitionRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── Plans ──────────────────────────────────────────────────────────

export async function insertPlan(tx: Writer, row: ManpowerPlanInsert): Promise<void> {
  await tx.insert(manpowerPlans).values(row);
}

export async function listPlans(tenantId: string, limit = 200): Promise<ManpowerPlanRow[]> {
  return scopedRead((tx) => tx.select().from(manpowerPlans)
    .where(eq(manpowerPlans.tenantId, tenantId))
    .orderBy(desc(manpowerPlans.planYear), desc(manpowerPlans.createdAt))
    .limit(limit));
}

export async function getPlan(tenantId: string, id: string): Promise<ManpowerPlanRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(manpowerPlans)
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function getPlanTx(tx: Writer, tenantId: string, id: string): Promise<ManpowerPlanRow | null> {
  const rows = await (tx as typeof db).select().from(manpowerPlans)
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Patch mutable strength/remarks fields — only while the plan is a draft. */
export async function updateDraftPlan(
  tx: Writer, tenantId: string, id: string,
  patch: Partial<Pick<ManpowerPlanInsert, "requiredStrength" | "sanctionedStrength" | "filledStrength" | "remarks">>,
): Promise<ManpowerPlanRow | null> {
  const rows = await (tx as typeof db).update(manpowerPlans)
    .set({ ...patch, updatedAt: new Date(), version: sql`${manpowerPlans.version} + 1` })
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId), eq(manpowerPlans.status, "draft")))
    .returning();
  return rows[0] ?? null;
}

/** draft → pending_approval (submit for approval). */
export async function submitPlan(tx: Writer, tenantId: string, id: string): Promise<ManpowerPlanRow | null> {
  const rows = await (tx as typeof db).update(manpowerPlans)
    .set({ status: "pending_approval", submittedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId), eq(manpowerPlans.status, "draft")))
    .returning();
  return rows[0] ?? null;
}

/** pending_approval → approved (checker). Guarded again in SQL by status. */
export async function approvePlan(tx: Writer, tenantId: string, id: string, approverId: string): Promise<ManpowerPlanRow | null> {
  const rows = await (tx as typeof db).update(manpowerPlans)
    .set({ status: "approved", approvedBy: approverId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId), eq(manpowerPlans.status, "pending_approval")))
    .returning();
  return rows[0] ?? null;
}

/** pending_approval → rejected (checker). */
export async function rejectPlan(tx: Writer, tenantId: string, id: string, approverId: string): Promise<ManpowerPlanRow | null> {
  const rows = await (tx as typeof db).update(manpowerPlans)
    .set({ status: "rejected", approvedBy: approverId, updatedAt: new Date() })
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId), eq(manpowerPlans.status, "pending_approval")))
    .returning();
  return rows[0] ?? null;
}

/** Atomically bump filled_strength by delta (from hire events). */
export async function bumpFilledStrengthTx(tx: Writer, tenantId: string, id: string, delta: number): Promise<void> {
  await (tx as typeof db).update(manpowerPlans)
    .set({ filledStrength: sql`${manpowerPlans.filledStrength} + ${delta}`, updatedAt: new Date() })
    .where(and(eq(manpowerPlans.id, id), eq(manpowerPlans.tenantId, tenantId)));
}

// ── Roster ─────────────────────────────────────────────────────────

export async function replaceRoster(
  tx: Writer, tenantId: string, planId: string,
  entries: Array<{ category: string; reservedCount: number }>,
): Promise<void> {
  await (tx as typeof db).delete(manpowerPlanRoster)
    .where(and(eq(manpowerPlanRoster.tenantId, tenantId), eq(manpowerPlanRoster.planId, planId)));
  if (entries.length === 0) return;
  await tx.insert(manpowerPlanRoster).values(entries.map((e) => ({
    tenantId, planId, category: e.category, reservedCount: e.reservedCount,
  })));
}

export async function listRoster(tenantId: string, planId: string): Promise<PlanRosterRow[]> {
  return scopedRead((tx) => tx.select().from(manpowerPlanRoster)
    .where(and(eq(manpowerPlanRoster.tenantId, tenantId), eq(manpowerPlanRoster.planId, planId))));
}

// ── Requisitions ───────────────────────────────────────────────────

export async function insertRequisition(tx: Writer, row: typeof manpowerRequisitions.$inferInsert): Promise<void> {
  await tx.insert(manpowerRequisitions).values(row);
}

export async function listRequisitions(tenantId: string, planId?: string, limit = 200): Promise<RequisitionRow[]> {
  const conds = [eq(manpowerRequisitions.tenantId, tenantId)];
  if (planId) conds.push(eq(manpowerRequisitions.planId, planId));
  return scopedRead((tx) => tx.select().from(manpowerRequisitions)
    .where(and(...conds))
    .orderBy(desc(manpowerRequisitions.createdAt))
    .limit(limit));
}

export async function getRequisition(tenantId: string, id: string): Promise<RequisitionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(manpowerRequisitions)
    .where(and(eq(manpowerRequisitions.id, id), eq(manpowerRequisitions.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

export async function findRequisitionByJobOpeningTx(tx: Writer, tenantId: string, jobOpeningId: string): Promise<RequisitionRow | null> {
  const rows = await (tx as typeof db).select().from(manpowerRequisitions)
    .where(and(eq(manpowerRequisitions.tenantId, tenantId), eq(manpowerRequisitions.jobOpeningId, jobOpeningId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function markRequisitionAdvertised(tx: Writer, tenantId: string, id: string, advertisementRef: string): Promise<RequisitionRow | null> {
  const rows = await (tx as typeof db).update(manpowerRequisitions)
    .set({ advertisementRef, status: "advertised", updatedAt: new Date() })
    .where(and(eq(manpowerRequisitions.id, id), eq(manpowerRequisitions.tenantId, tenantId)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Atomically increment filled_count for a requisition and flip it to 'filled'
 * once the requested vacancies are met. Returns the updated row (or null).
 */
export async function incrementRequisitionFillTx(tx: Writer, tenantId: string, id: string): Promise<RequisitionRow | null> {
  const rows = await (tx as typeof db).update(manpowerRequisitions)
    .set({
      filledCount: sql`${manpowerRequisitions.filledCount} + 1`,
      status: sql`CASE WHEN ${manpowerRequisitions.filledCount} + 1 >= ${manpowerRequisitions.requestedVacancies}
                       AND ${manpowerRequisitions.status} <> 'closed'
                       THEN 'filled' ELSE ${manpowerRequisitions.status} END`,
      updatedAt: new Date(),
    })
    .where(and(eq(manpowerRequisitions.id, id), eq(manpowerRequisitions.tenantId, tenantId)))
    .returning();
  return rows[0] ?? null;
}
