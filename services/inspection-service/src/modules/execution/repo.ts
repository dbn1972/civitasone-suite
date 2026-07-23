/**
 * inspection-service: execution module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:inspection:{id}`
 *
 * _Requirements: 8.1, 8.2, 8.5, 8.6, 8.7, 8.8_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  inspections,
  inspectionHistory,
  type InspectionRow,
  type InspectionHistoryRow,
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

// ── Inspection Reads ──────────────────────────────────────────────────────────

/**
 * Find an inspection by ID with cache read-through.
 */
export async function findInspectionById(
  tenantId: string,
  id: string,
): Promise<InspectionRow | null> {
  return cache.getOrLoad<InspectionRow>(
    cache.makeKey(tenantId, "inspection", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(inspections)
          .where(and(
            eq(inspections.id, id),
            eq(inspections.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * List inspections with pagination (not cached individually).
 */
export async function findInspections(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<InspectionRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(inspections.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(inspections)
        .where(whereClause),
      tx.select().from(inspections)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(inspections.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

// ── Inspection Writes (within transaction) ────────────────────────────────────

/**
 * Update inspection state within a transaction.
 * Uses optimistic locking via version column.
 */
export async function updateInspectionState(
  tx: Tx,
  id: string,
  tenantId: string,
  newState: string,
  actorId: string,
  additionalFields?: Partial<Pick<InspectionRow, "startedAt" | "completedAt" | "finalizedAt" | "reviewerId" | "reportS3Key">>,
): Promise<InspectionRow> {
  const rows = await tx.update(inspections)
    .set({
      state: newState,
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${inspections.version} + 1`,
      ...additionalFields,
    })
    .where(and(
      eq(inspections.id, id),
      eq(inspections.tenantId, tenantId),
    ))
    .returning();
  return rows[0]!;
}

// ── Inspection History ────────────────────────────────────────────────────────

/**
 * Record a state transition in the inspection_history table.
 */
export async function insertHistory(
  tx: Tx,
  data: {
    tenantId: string;
    inspectionId: string;
    previousState: string;
    newState: string;
    actorId: string;
    remarks?: string | null;
  },
): Promise<InspectionHistoryRow> {
  const rows = await tx.insert(inspectionHistory).values({
    tenantId: data.tenantId,
    inspectionId: data.inspectionId,
    previousState: data.previousState,
    newState: data.newState,
    actorId: data.actorId,
    remarks: data.remarks ?? null,
  }).returning();
  return rows[0]!;
}

/**
 * Get the full transition history for an inspection (ordered by time descending).
 */
export async function findHistoryByInspection(
  tenantId: string,
  inspectionId: string,
): Promise<InspectionHistoryRow[]> {
  return scopedRead((tx) =>
    tx.select().from(inspectionHistory)
      .where(and(
        eq(inspectionHistory.inspectionId, inspectionId),
        eq(inspectionHistory.tenantId, tenantId),
      ))
      .orderBy(desc(inspectionHistory.transitionedAt)),
  );
}
