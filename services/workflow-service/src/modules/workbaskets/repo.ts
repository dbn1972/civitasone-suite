import { randomUUID } from "node:crypto";
import { and, eq, asc, desc, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";

export type Writer = Pick<typeof db, "select" | "insert" | "update">;
import { workbaskets, type WorkbasketRow } from "./schema.js";
import { tasks, type TaskRow } from "../tasks/schema.js";
import type { WorkbasketFilter } from "./domain.js";

export async function list(tenantId: string): Promise<WorkbasketRow[]> {
  return scopedRead((tx) => tx.select().from(workbaskets)
    .where(eq(workbaskets.tenantId, tenantId)).orderBy(asc(workbaskets.code)));
}
export async function findByCode(tenantId: string, code: string): Promise<WorkbasketRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(workbaskets)
    .where(and(eq(workbaskets.tenantId, tenantId), eq(workbaskets.code, code))).limit(1));
  return rows[0];
}

export interface UpsertInput {
  tenantId: string; code: string; name: string; description?: string | undefined;
  filter: Record<string, unknown>; sortOrder: string; actorId: string;
}
export async function upsert(input: UpsertInput): Promise<WorkbasketRow> {
  return db.transaction((tx) => upsertTx(tx, input));
}

/** Tx-scoped twin of upsert for callers already inside an open transaction. */
export async function upsertTx(tx: Writer, input: UpsertInput): Promise<WorkbasketRow> {
  const id = randomUUID();
  const insRows = await tx.insert(workbaskets).values({
    id, tenantId: input.tenantId, code: input.code, name: input.name,
    description: input.description ?? null, filter: input.filter, sortOrder: input.sortOrder, createdBy: input.actorId,
  }).onConflictDoUpdate({
    target: [workbaskets.tenantId, workbaskets.code],
    set: { name: input.name, description: input.description ?? null, filter: input.filter, sortOrder: input.sortOrder, updatedAt: new Date() },
  }).returning();
  return insRows[0]!;
}

/** CAP-035 — run a workbasket's filter against the task pool (tenant-scoped). */
export async function resolveTasks(
  tenantId: string, filter: WorkbasketFilter, sortOrder: string, limit: number,
  viewer?: { roles: readonly string[]; actorId?: string },
): Promise<TaskRow[]> {
  const conds: SQL[] = [eq(tasks.tenantId, tenantId)];
  // UAT #2445 review item 3: a workbasket is a saved filter, not a membership (there
  // is no member table); anyone with a workflow user role may run it. So it runs over
  // the caller's own task pool: tasks for a role they hold, or assigned to them.
  // super_admin / workflow_admin see the whole tenant pool.
  if (viewer && !viewer.roles.some((r) => r === "super_admin" || r === "workflow_admin")) {
    const actor = viewer.actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(viewer.actorId) ? viewer.actorId : null;
    const parts = [
      ...(viewer.roles.length ? [inArray(tasks.roleRef, [...viewer.roles])] : []),
      ...(actor ? [eq(tasks.assigneeId, actor)] : []),
    ];
    conds.push(parts.length ? or(...parts)! : sql`false`);
  }
  if (filter.status && filter.status.length > 0) conds.push(inArray(tasks.status, filter.status));
  if (filter.unassigned) conds.push(isNull(tasks.assigneeId));
  else if (filter.assigneeId) conds.push(eq(tasks.assigneeId, filter.assigneeId));
  if (filter.roleRef) conds.push(eq(tasks.roleRef, filter.roleRef));
  if (filter.overdue) conds.push(sql`${tasks.dueAt} IS NOT NULL AND ${tasks.dueAt} < now()`);
  const orderCol = sortOrder === "due_at" ? tasks.dueAt : sortOrder === "updated_at" ? tasks.updatedAt : tasks.createdAt;
  return scopedRead((tx) => tx.select().from(tasks).where(and(...conds)).orderBy(desc(orderCol)).limit(limit));
}
