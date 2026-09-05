/**
 * inspection-service: assignment module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:{resource}:{id}`
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5, 4.8_
 */
import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  inspectionAssignments,
  conflictDeclarations,
  tourPlans,
  geoAttendance,
  inspectorCapacity,
  type InspectionAssignmentRow,
  type InspectionAssignmentInsert,
  type ConflictDeclarationRow,
  type TourPlanRow,
  type TourPlanInsert,
  type GeoAttendanceRow,
  type GeoAttendanceInsert,
  type InspectorCapacityRow,
} from "./schema.js";

// ── Type Aliases ──────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Inspection Assignments ────────────────────────────────────────────────────

/**
 * Paginated list of assignments for a tenant with optional inspector filter.
 */
export async function findAssignmentsByTenant(
  tenantId: string,
  filters: { inspectorId?: string; status?: string },
  pagination: PaginationInput,
): Promise<PaginatedResult<InspectionAssignmentRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(inspectionAssignments.tenantId, tenantId)];

    if (filters.inspectorId) {
      conditions.push(eq(inspectionAssignments.inspectorId, filters.inspectorId));
    }
    if (filters.status) {
      conditions.push(eq(inspectionAssignments.status, filters.status));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(inspectionAssignments)
        .where(whereClause),
      tx.select().from(inspectionAssignments)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(inspectionAssignments.scheduledDate),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new inspection assignment within a transaction.
 */
export async function insertAssignment(
  tx: Tx,
  data: InspectionAssignmentInsert,
): Promise<InspectionAssignmentRow> {
  const rows = await tx.insert(inspectionAssignments).values(data).returning();
  return rows[0]!;
}

/**
 * Find conflict declarations for a given inspector within a tenant.
 */
export async function findConflicts(
  tenantId: string,
  inspectorId: string,
): Promise<ConflictDeclarationRow[]> {
  return scopedRead(async (tx) => {
    return tx.select().from(conflictDeclarations)
      .where(and(
        eq(conflictDeclarations.tenantId, tenantId),
        eq(conflictDeclarations.inspectorId, inspectorId),
      ));
  });
}

/**
 * Tx-scoped variant of findConflicts: reads through the caller's already-open
 * transaction instead of opening a nested one via scopedRead. Used by
 * inspectorAssign (assignment/consumer.ts) -- calling the scopedRead-based
 * version from inside an open db.transaction() opens a SECOND transaction
 * competing for a connection from the same pool as the outer one, deadlocking
 * every in-flight command once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function findConflictsTx(
  tx: Tx,
  tenantId: string,
  inspectorId: string,
): Promise<ConflictDeclarationRow[]> {
  return tx.select().from(conflictDeclarations)
    .where(and(
      eq(conflictDeclarations.tenantId, tenantId),
      eq(conflictDeclarations.inspectorId, inspectorId),
    ));
}

/**
 * Count assignments for an inspector on a specific date (for capacity validation).
 */
export async function countDailyAssignments(
  tenantId: string,
  inspectorId: string,
  scheduledDate: string,
): Promise<number> {
  return scopedRead(async (tx) => {
    const result = await tx.select({ count: sql<number>`count(*)::int` })
      .from(inspectionAssignments)
      .where(and(
        eq(inspectionAssignments.tenantId, tenantId),
        eq(inspectionAssignments.inspectorId, inspectorId),
        eq(inspectionAssignments.scheduledDate, scheduledDate),
      ));
    return result[0]?.count ?? 0;
  });
}

/**
 * Tx-scoped variant of countDailyAssignments -- see findConflictsTx above.
 */
export async function countDailyAssignmentsTx(
  tx: Tx,
  tenantId: string,
  inspectorId: string,
  scheduledDate: string,
): Promise<number> {
  const result = await tx.select({ count: sql<number>`count(*)::int` })
    .from(inspectionAssignments)
    .where(and(
      eq(inspectionAssignments.tenantId, tenantId),
      eq(inspectionAssignments.inspectorId, inspectorId),
      eq(inspectionAssignments.scheduledDate, scheduledDate),
    ));
  return result[0]?.count ?? 0;
}

/**
 * Find inspector capacity record (daily limit + competencies).
 */
export async function findCapacity(
  tenantId: string,
  inspectorId: string,
): Promise<InspectorCapacityRow | null> {
  return cache.getOrLoad<InspectorCapacityRow>(
    cache.makeKey(tenantId, "inspector_capacity", inspectorId),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(inspectorCapacity)
          .where(and(
            eq(inspectorCapacity.tenantId, tenantId),
            eq(inspectorCapacity.inspectorId, inspectorId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Tx-scoped variant of findCapacity -- see findConflictsTx above. Bypasses
 * the read-through cache deliberately: a value read inside the caller's own
 * transaction must reflect the current transaction's view, not a
 * possibly-stale cached one.
 */
export async function findCapacityTx(
  tx: Tx,
  tenantId: string,
  inspectorId: string,
): Promise<InspectorCapacityRow | null> {
  const rows = await tx.select().from(inspectorCapacity)
    .where(and(
      eq(inspectorCapacity.tenantId, tenantId),
      eq(inspectorCapacity.inspectorId, inspectorId),
    ));
  return rows[0] ?? null;
}

// ── Geo-Attendance ────────────────────────────────────────────────────────────

/**
 * Insert a geo-attendance record within a transaction.
 */
export async function insertGeoAttendance(
  tx: Tx,
  data: GeoAttendanceInsert,
): Promise<GeoAttendanceRow> {
  const rows = await tx.insert(geoAttendance).values(data).returning();
  return rows[0]!;
}

// ── Tour Plans ────────────────────────────────────────────────────────────────

/**
 * Insert a tour plan within a transaction.
 */
export async function insertTourPlan(
  tx: Tx,
  data: TourPlanInsert,
): Promise<TourPlanRow> {
  const rows = await tx.insert(tourPlans).values(data).returning();
  return rows[0]!;
}

/**
 * Find tour plan for a specific inspector (most recent within tenant).
 */
export async function findTourPlan(
  tenantId: string,
  inspectorId: string,
): Promise<TourPlanRow | null> {
  return cache.getOrLoad<TourPlanRow>(
    cache.makeKey(tenantId, "tour_plan", inspectorId),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(tourPlans)
          .where(and(
            eq(tourPlans.tenantId, tenantId),
            eq(tourPlans.inspectorId, inspectorId),
          ))
          .orderBy(sql`${tourPlans.createdAt} DESC`)
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Find a tour plan by id within a tenant (approval-workflow lookups).
 * Cached separately from `findTourPlan` (keyed by id, not inspectorId).
 */
export async function findTourPlanById(
  tenantId: string,
  id: string,
): Promise<TourPlanRow | null> {
  return cache.getOrLoad<TourPlanRow>(
    cache.makeKey(tenantId, "tour_plan_id", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(tourPlans)
          .where(and(
            eq(tourPlans.id, id),
            eq(tourPlans.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Tx-scoped variant of findTourPlanById -- see findConflictsTx above.
 * Bypasses the read-through cache deliberately, same reasoning as
 * findCapacityTx.
 */
export async function findTourPlanByIdTx(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<TourPlanRow | null> {
  const rows = await tx.select().from(tourPlans)
    .where(and(
      eq(tourPlans.id, id),
      eq(tourPlans.tenantId, tenantId),
    ));
  return rows[0] ?? null;
}

/**
 * Transition a tour plan draft -> submitted (SVC-109).
 *
 * The `eq(tourPlans.status, "draft")` guard is enforced IN THE UPDATE itself
 * (not just checked beforehand) so a concurrent transition between the
 * consumer's pre-check and this write cannot silently double-apply: if the
 * row is no longer in 'draft' the UPDATE matches zero rows and this returns
 * null, which the consumer treats as a non-retryable "no longer submittable"
 * error rather than as success.
 */
export async function submitTourPlan(
  tx: Tx,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<TourPlanRow | null> {
  const rows = await tx.update(tourPlans)
    .set({
      status: "submitted",
      submittedBy: actorId,
      submittedAt: new Date(),
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${tourPlans.version} + 1`,
    })
    .where(and(
      eq(tourPlans.id, id),
      eq(tourPlans.tenantId, tenantId),
      eq(tourPlans.status, "draft"),
    ))
    .returning();
  return rows[0] ?? null;
}

/**
 * Transition a tour plan submitted -> approved (SVC-109).
 *
 * Same guarded-UPDATE pattern as {@link submitTourPlan}: the WHERE clause
 * requires status = 'submitted', so a race or redelivery that finds the plan
 * already approved (or never submitted) matches zero rows instead of
 * double-applying. Maker-checker (approver != submitter) is enforced by the
 * caller BEFORE this is invoked, using the submittedBy captured by
 * submitTourPlan.
 */
export async function approveTourPlan(
  tx: Tx,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<TourPlanRow | null> {
  const rows = await tx.update(tourPlans)
    .set({
      status: "approved",
      approvedBy: actorId,
      approvedAt: new Date(),
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${tourPlans.version} + 1`,
    })
    .where(and(
      eq(tourPlans.id, id),
      eq(tourPlans.tenantId, tenantId),
      eq(tourPlans.status, "submitted"),
    ))
    .returning();
  return rows[0] ?? null;
}
