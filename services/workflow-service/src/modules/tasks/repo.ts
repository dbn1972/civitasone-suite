import { eq, desc, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tasks, type TaskRow, type TaskInsert, type TaskView } from "./schema.js";

export function toView(r: TaskRow): TaskView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    instanceId: r.instanceId,
    name: r.name,
    status: r.status,
    roleRef: r.roleRef,
    nodeKey: r.nodeKey,
    refType: r.refType,
    refId: r.refId,
    decision: r.decision,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<TaskView | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TaskView[]> {
  const rows = await db.select().from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export async function listPendingForRoles(
  tenantId: string,
  roles: string[],
  limit: number,
  offset: number,
): Promise<TaskView[]> {
  const rows = await db.select().from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), eq(tasks.status, "pending")))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit * 3)
    .offset(offset);

  const filtered = rows.filter((r) => !r.roleRef || roles.includes(r.roleRef) || roles.includes("super_admin"));
  return filtered.slice(0, limit).map(toView);
}

export async function findByIdTx(tx: Writer, id: string): Promise<TaskRow | null> {
  const rows = await (tx as typeof db).select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * SoD: has this actor already completed any prior task on this instance?
 * Used to block a repeat actor from acting on a downstream step.
 */
export async function priorActorTasks(tx: Writer, instanceId: string, actorId: string): Promise<TaskRow[]> {
  return (tx as typeof db).select().from(tasks)
    .where(and(
      eq(tasks.instanceId, instanceId),
      eq(tasks.status, "completed"),
      eq(tasks.completedBy, actorId),
    ));
}

/**
 * C2 — DURABLE SoD: prior tasks on this instance already completed by `actorId`,
 * read with FOR UPDATE so concurrent completion transactions serialize on the
 * same instance's completed rows. Run inside the consumer transaction (which
 * also holds the instance row lock) so the repeat-actor check sees committed
 * completions rather than racing past them.
 */
export async function priorActorTasksTx(tx: Writer, instanceId: string, actorId: string): Promise<TaskRow[]> {
  return (tx as typeof db).select().from(tasks)
    .where(and(
      eq(tasks.instanceId, instanceId),
      eq(tasks.status, "completed"),
      eq(tasks.completedBy, actorId),
    ))
    .for("update");
}

/** Number of still-open (pending) tasks on an instance — used for join gating. */
export async function countOpenTasks(tx: Writer, instanceId: string): Promise<number> {
  const rows = await (tx as typeof db).select().from(tasks)
    .where(and(eq(tasks.instanceId, instanceId), eq(tasks.status, "pending")));
  return rows.length;
}

/** Open tasks for a specific node key (used to detect/avoid duplicate join tasks). */
export async function openTasksAtNode(tx: Writer, instanceId: string, nodeKey: string): Promise<TaskRow[]> {
  return (tx as typeof db).select().from(tasks)
    .where(and(
      eq(tasks.instanceId, instanceId),
      eq(tasks.nodeKey, nodeKey),
      eq(tasks.status, "pending"),
    ));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TaskInsert): Promise<void> {
  await tx.insert(tasks).values(row);
}

/** Reopen a prior task for return/rework. */
export async function reopen(tx: Writer, id: string, actorId: string): Promise<void> {
  await tx.update(tasks)
    .set({ status: "pending", decision: null, completedBy: null, updatedBy: actorId, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function markCompleted(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
  decision: string,
  sodOverride = false,
): Promise<TaskView | null> {
  const existing = await findById(id, tenantId);
  if (!existing || existing.status === "completed") return null;
  // H2 — optimistic lock. Guard the UPDATE with `status='pending'` and a
  // version predicate so a second completeTask message for the same task (or a
  // concurrent worker) cannot re-complete it. `returning()` lets us detect the
  // 0-rows-affected conflict and skip advancing the instance.
  const updated = await tx.update(tasks).set({
    status: "completed",
    decision,
    completedBy: actorId,
    sodOverride,
    updatedBy: actorId,
    updatedAt: new Date(),
    version: existing.version + 1,
  })
    .where(and(
      eq(tasks.id, id),
      eq(tasks.status, "pending"),
      eq(tasks.version, existing.version),
    ))
    .returning({ id: tasks.id });
  if (updated.length === 0) return null; // conflict: already completed elsewhere
  return { ...existing, status: "completed", decision, version: existing.version + 1 };
}
