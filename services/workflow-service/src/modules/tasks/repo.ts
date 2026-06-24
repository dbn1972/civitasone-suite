import { eq, desc, and, or, isNull, isNotNull, lte, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tasks, type TaskRow, type TaskInsert, type TaskView } from "./schema.js";
import { instances } from "../instances/schema.js";
import { definitionNodes } from "../definitions/schema.js";

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
    assigneeId: r.assigneeId,
    isCall: r.isCall,
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
  // L1 — filter by role in SQL (not in app code after a limit*3 fetch, which
  // silently dropped matching tasks beyond the window). A task with no roleRef
  // is unrestricted; super_admin sees every pending task.
  const isSuperAdmin = roles.includes("super_admin");
  const rolePredicate = isSuperAdmin
    ? undefined
    : roles.length > 0
      ? or(isNull(tasks.roleRef), inArray(tasks.roleRef, roles))
      : isNull(tasks.roleRef);

  const rows = await db.select().from(tasks)
    .where(and(
      eq(tasks.tenantId, tenantId),
      eq(tasks.status, "pending"),
      eq(tasks.isCall, false),
      ...(rolePredicate ? [rolePredicate] : []),
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit)
    .offset(offset);

  return rows.map(toView);
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

/**
 * P1-4 — remap pending tasks at `oldNode` to `newNode` during an in-flight
 * version migration, refreshing name/roleRef from the target node so the task
 * (and the edges resolved from it on completion) align with the new graph.
 * Returns the number of tasks remapped.
 */
export async function remapOpenTaskNode(
  tx: Writer,
  instanceId: string,
  oldNode: string,
  newNode: string,
  newName: string,
  newRoleRef: string | null,
  actorId: string,
): Promise<number> {
  const updated = await (tx as typeof db).update(tasks)
    // SECURITY C-2 — clear fire_at on remap: a timer task migrated onto a
    // different (possibly human / non-opted-in) node must NOT carry its old
    // deemed-approval fire time, or the sweeper could auto-approve it. The
    // dueTimers node-type re-check is the primary guard; clearing fire_at here
    // is defence-in-depth so the row no longer even matches the sweep filter.
    .set({ nodeKey: newNode, name: newName, roleRef: newRoleRef, fireAt: null, updatedBy: actorId, updatedAt: new Date() })
    .where(and(
      eq(tasks.instanceId, instanceId),
      eq(tasks.nodeKey, oldNode),
      eq(tasks.status, "pending"),
    ))
    .returning({ id: tasks.id });
  return updated.length;
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

/**
 * P1-1 — claim an UNASSIGNED pending task for `actorId`. Guarded by
 * `assignee_id IS NULL` + `status='pending'` + the version predicate so two
 * concurrent claimers cannot both win; the loser gets 0 rows (null) and a 409.
 */
export async function claim(
  id: string,
  tenantId: string,
  actorId: string,
): Promise<TaskView | null> {
  const existing = await findById(id, tenantId);
  if (!existing) return null;
  const updated = await db.update(tasks).set({
    assigneeId: actorId,
    updatedBy: actorId,
    updatedAt: new Date(),
    version: existing.version + 1,
  })
    .where(and(
      eq(tasks.id, id),
      eq(tasks.status, "pending"),
      isNull(tasks.assigneeId),
      eq(tasks.version, existing.version),
    ))
    .returning({ id: tasks.id });
  if (updated.length === 0) return null;
  return { ...existing, assigneeId: actorId, version: existing.version + 1 };
}

/**
 * P1-1 / SECURITY M-1 — (re)assign a pending task to a specific user inside a
 * caller transaction, so the assignment and its transition_history audit row
 * commit atomically. Returns the prior assignee (for the audit) alongside the
 * updated view, or null on optimistic-lock conflict.
 */
export async function assignTx(
  tx: Writer,
  id: string,
  tenantId: string,
  assigneeId: string,
  actorId: string,
): Promise<{ view: TaskView; priorAssigneeId: string | null } | null> {
  const existing = await findById(id, tenantId);
  if (!existing) return null;
  const updated = await (tx as typeof db).update(tasks).set({
    assigneeId,
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
  if (updated.length === 0) return null;
  return {
    view: { ...existing, assigneeId, version: existing.version + 1 },
    priorAssigneeId: existing.assigneeId ?? null,
  };
}

/** P1-1 — (re)assign a pending task to a specific user (admin / reassignment). */
export async function assign(
  id: string,
  tenantId: string,
  assigneeId: string,
  actorId: string,
): Promise<TaskView | null> {
  const existing = await findById(id, tenantId);
  if (!existing) return null;
  const updated = await db.update(tasks).set({
    assigneeId,
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
  if (updated.length === 0) return null;
  return { ...existing, assigneeId, version: existing.version + 1 };
}

/**
 * P1-2 — pending timer tasks whose fire_at has passed, for the deemed-approval
 * sweeper. Batched; the sweeper re-locks each before advancing.
 */
export async function dueTimers(now: Date, batch: number): Promise<TaskRow[]> {
  // SECURITY C-2 — re-verify the node type at fire time. A task only qualifies
  // for deemed-approval auto-completion if, AT FIRE TIME, its current
  // definition node is a `timer` that is EXPLICITLY opted in for deemed
  // approval (deemed_approval = true). We resolve the node through the
  // instance's bound definition (instance.definitionId) + the task's nodeKey,
  // so a stale fire_at on a task remapped onto a non-timer / non-opted-in node
  // is NOT auto-completed.
  const rows = await db.select({ task: tasks }).from(tasks)
    .innerJoin(instances, eq(instances.id, tasks.instanceId))
    .innerJoin(
      definitionNodes,
      and(
        eq(definitionNodes.definitionId, instances.definitionId),
        eq(definitionNodes.nodeKey, tasks.nodeKey),
      ),
    )
    .where(and(
      eq(tasks.status, "pending"),
      isNotNull(tasks.fireAt),
      lte(tasks.fireAt, now),
      eq(definitionNodes.nodeType, "timer"),
      eq(definitionNodes.deemedApproval, true),
    ))
    .limit(batch);
  return rows.map((r) => r.task);
}
