/**
 * tasks/repo.ts — Database operations for field tasks.
 */
import { eq, and, sql, desc, type SQL, lte, gte, isNotNull } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { tasks, type TaskRow, type TaskInsert } from "./schema.js";

export function toView(r: TaskRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    assigneeId: r.assigneeId,
    taskType: r.taskType,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    latitude: r.latitude,
    longitude: r.longitude,
    address: r.address,
    dueDate: r.dueDate?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type TaskView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<TaskRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export interface ListFilters {
  status?: string | undefined;
  assigneeId?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
  filters: ListFilters = {},
): Promise<{ rows: TaskRow[]; total: number }> {
  const conditions: SQL[] = [eq(tasks.tenantId, tenantId)];

  if (filters.status) {
    conditions.push(eq(tasks.status, filters.status));
  }
  if (filters.assigneeId) {
    conditions.push(eq(tasks.assigneeId, filters.assigneeId));
  }
  if (filters.dueBefore) {
    conditions.push(lte(tasks.dueDate, new Date(filters.dueBefore)));
  }
  if (filters.dueAfter) {
    conditions.push(gte(tasks.dueDate, new Date(filters.dueAfter)));
  }

  const where = and(...conditions);

  const rows = await scopedRead((tx) =>
    tx.select().from(tasks).where(where).orderBy(desc(tasks.createdAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: TaskInsert): Promise<void> {
  await tx.insert(tasks).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<TaskInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(tasks)
    .set({ ...patch, updatedAt: new Date(), version: sql`${tasks.version} + 1` })
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, tenantId), eq(tasks.version, currentVersion)))
    .returning({ id: tasks.id });
  return result.length > 0;
}

// ─── Agent roster (distinct assignees across all tasks) ─────────────────────

export async function listAgents(
  tenantId: string,
): Promise<{ agentId: string; taskCount: number }[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({
        agentId: tasks.assigneeId,
        taskCount: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), isNotNull(tasks.assigneeId)))
      .groupBy(tasks.assigneeId),
  );
  return rows
    .filter((r): r is { agentId: string; taskCount: number } => r.agentId !== null)
    .map((r) => ({ agentId: r.agentId, taskCount: r.taskCount }));
}

// ─── Dashboard KPIs (task counts by status) ─────────────────────────────────

export async function getKpis(tenantId: string): Promise<{ status: string; count: number }[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.tenantId, tenantId))
      .groupBy(tasks.status),
  );
  return rows.map((r) => ({ status: r.status, count: r.count }));
}
