/**
 * inspection-service: checklist module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:{resource}:{id}`
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.5_
 */
import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  checklistTemplates,
  checklistInstances,
  type ChecklistTemplateRow,
  type ChecklistTemplateInsert,
  type ChecklistInstanceRow,
  type ChecklistInstanceInsert,
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

// ── Checklist Templates ───────────────────────────────────────────────────────

/**
 * Find a checklist template by ID with cache read-through.
 * Falls through to DB on cache miss/failure.
 */
export async function findTemplateById(
  tenantId: string,
  id: string,
): Promise<ChecklistTemplateRow | null> {
  return cache.getOrLoad<ChecklistTemplateRow>(
    cache.makeKey(tenantId, "checklist_template", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(checklistTemplates)
          .where(and(
            eq(checklistTemplates.id, id),
            eq(checklistTemplates.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Paginated list of checklist templates for a tenant.
 * List queries go directly to Postgres (not cached individually).
 */
export async function findTemplatesByTenant(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<ChecklistTemplateRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(checklistTemplates.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(checklistTemplates)
        .where(whereClause),
      tx.select().from(checklistTemplates)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(checklistTemplates.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new checklist template within a transaction.
 */
export async function insertTemplate(
  tx: Tx,
  data: ChecklistTemplateInsert,
): Promise<ChecklistTemplateRow> {
  const rows = await tx.insert(checklistTemplates).values(data).returning();
  return rows[0]!;
}

/**
 * Update a checklist template with optimistic locking.
 * Throws 409 Conflict if the version does not match.
 */
export async function updateTemplate(
  tx: Tx,
  id: string,
  version: number,
  patch: Partial<ChecklistTemplateInsert>,
): Promise<ChecklistTemplateRow> {
  const rows = await tx.update(checklistTemplates)
    .set({ ...patch, version: version + 1, updatedAt: new Date() })
    .where(and(
      eq(checklistTemplates.id, id),
      eq(checklistTemplates.version, version),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", `Template ${id} has been modified by another request (expected version ${version})`);
  }

  return rows[0]!;
}

// ── Checklist Instances ───────────────────────────────────────────────────────

/**
 * Find a checklist instance by ID with cache read-through.
 */
export async function findInstanceById(
  tenantId: string,
  id: string,
): Promise<ChecklistInstanceRow | null> {
  return cache.getOrLoad<ChecklistInstanceRow>(
    cache.makeKey(tenantId, "checklist_instance", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(checklistInstances)
          .where(and(
            eq(checklistInstances.id, id),
            eq(checklistInstances.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Find checklist instances by inspection ID.
 */
export async function findInstancesByInspection(
  tenantId: string,
  inspectionId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<ChecklistInstanceRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(checklistInstances.tenantId, tenantId),
      eq(checklistInstances.inspectionId, inspectionId),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(checklistInstances)
        .where(whereClause),
      tx.select().from(checklistInstances)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(checklistInstances.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new checklist instance within a transaction.
 */
export async function insertInstance(
  tx: Tx,
  data: ChecklistInstanceInsert,
): Promise<ChecklistInstanceRow> {
  const rows = await tx.insert(checklistInstances).values(data).returning();
  return rows[0]!;
}

/**
 * Update a checklist instance with optimistic locking.
 * Throws 409 Conflict if the version does not match.
 */
export async function updateInstance(
  tx: Tx,
  id: string,
  version: number,
  patch: Partial<ChecklistInstanceInsert>,
): Promise<ChecklistInstanceRow> {
  const rows = await tx.update(checklistInstances)
    .set({ ...patch, version: version + 1, updatedAt: new Date() })
    .where(and(
      eq(checklistInstances.id, id),
      eq(checklistInstances.version, version),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", `Instance ${id} has been modified by another request (expected version ${version})`);
  }

  return rows[0]!;
}
