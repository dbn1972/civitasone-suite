/**
 * inspection-service: planning module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-plan lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:plan:{id}`
 *
 * _Requirements: 3.4, 3.5, 3.6, 3.7_
 */
import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  inspectionPlans,
  type InspectionPlanRow,
  type InspectionPlanInsert,
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

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * Find an inspection plan by ID with cache read-through.
 * Falls through to DB on cache miss/failure and logs WARN (handled by cache lib).
 */
export async function findPlanById(
  tenantId: string,
  id: string,
): Promise<InspectionPlanRow | null> {
  return cache.getOrLoad<InspectionPlanRow>(
    cache.makeKey(tenantId, "plan", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(inspectionPlans)
          .where(and(
            eq(inspectionPlans.id, id),
            eq(inspectionPlans.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Paginated list of plans for a tenant with optional status filter.
 * List queries go directly to Postgres (not cached individually).
 */
export async function findPlansByTenant(
  tenantId: string,
  pagination: PaginationInput,
  statusFilter?: string,
): Promise<PaginatedResult<InspectionPlanRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(inspectionPlans.tenantId, tenantId)];

    if (statusFilter) {
      conditions.push(eq(inspectionPlans.status, statusFilter));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(inspectionPlans)
        .where(whereClause),
      tx.select().from(inspectionPlans)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(inspectionPlans.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Insert a new inspection plan within a transaction.
 */
export async function insertPlan(
  tx: Tx,
  data: InspectionPlanInsert,
): Promise<InspectionPlanRow> {
  const rows = await tx.insert(inspectionPlans).values(data).returning();
  return rows[0]!;
}

/**
 * Update an inspection plan with optimistic locking.
 * Throws 409 Conflict if the version does not match.
 */
export async function updatePlan(
  tx: Tx,
  id: string,
  version: number,
  patch: Partial<InspectionPlanInsert>,
): Promise<InspectionPlanRow> {
  const rows = await tx.update(inspectionPlans)
    .set({ ...patch, version: version + 1, updatedAt: new Date() })
    .where(and(
      eq(inspectionPlans.id, id),
      eq(inspectionPlans.version, version),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", `Plan ${id} has been modified by another request (expected version ${version})`);
  }

  return rows[0]!;
}
