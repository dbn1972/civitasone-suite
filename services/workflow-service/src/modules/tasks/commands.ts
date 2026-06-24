import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, TASK_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { tasks } from "./schema.js";
import * as instanceRepo from "../instances/repo.js";
import * as delegationRepo from "../delegations/repo.js";
import * as historyRepo from "../history/repo.js";
import type { TaskView } from "./schema.js";

/** YYYY-MM-DD in UTC, used to bound active-delegation validity. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Accepted = { id: string; status: string; correlationId: string };

export async function completeTask(
  ctx: RequestContext,
  taskId: string,
  decision: "approve" | "reject" | "return" = "approve",
): Promise<Accepted> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status === "completed") throw new HttpError(409, "CONFLICT", "task already completed");
  // Gap 1 — a call task is a system wait task held until its child instance
  // completes; it is auto-resolved by the engine, never by a human.
  if (existing.isCall) throw new HttpError(409, "CALL_TASK", "this is a sub-workflow call task; it completes when its child instance finishes");

  // P0-2 — a task may only be completed while its instance is active. Suspended
  // or cancelled instances block task completion (409); resuming re-enables it.
  // This is the friendly pre-check; the consumer re-checks under the row lock.
  const lifecycleInstance = await instanceRepo.findById(existing.instanceId, ctx.tenantId);
  if (lifecycleInstance && lifecycleInstance.status !== "active") {
    throw new HttpError(409, "INSTANCE_NOT_ACTIVE", `instance is ${lifecycleInstance.status}; tasks cannot be completed`);
  }

  const isSuperAdmin = ctx.roles.includes("super_admin");
  let sodOverride = false;

  // L3 — active delegations naming the actor as delegate. An active delegation
  // lets the delegate act on behalf of the delegator's role. We consult these
  // both for the role-on-task gate (a delegate may pass the gate even without
  // holding roleRef directly) and for SoD identity (the delegate stands in for
  // the delegator, so a delegation from the submitter / a prior actor is itself
  // a SoD conflict and is blocked).
  const activeDelegations = await delegationRepo.activeForDelegate(ctx.tenantId, ctx.actorId, today());
  const delegatorIds = new Set(activeDelegations.map((d) => d.delegatorId));

  // C1 — role-on-task authorization. The broad requireRole() gate at the route
  // only proves the actor holds *some* workflow role; it never checks the
  // actor's roles against THIS task's roleRef. Without this, any tenant user
  // with any workflow role could complete any task regardless of refType
  // (the route's permission if-chain leaves estab_file/asset_disposal/etc with
  // no gate at all). Rule: unless super_admin (break-glass), the actor must
  // hold the task's roleRef. A task with no roleRef is unrestricted.
  // A delegate holding an active delegation may act on behalf of the
  // delegator's role, so the presence of any active delegation satisfies the
  // role gate (the delegator is presumed to hold the task's role).
  const hasActiveDelegation = activeDelegations.length > 0;
  if (!isSuperAdmin && existing.roleRef && !ctx.roles.includes(existing.roleRef) && !hasActiveDelegation) {
    throw new HttpError(403, "ROLE_NOT_AUTHORIZED", `this task requires role '${existing.roleRef}'`);
  }

  // P1-1 — assignee lock. Once a task is claimed/assigned to a specific user it
  // is completable ONLY by that assignee (or an admin break-glass: super_admin /
  // workflow_admin). A delegate acting for the assignee also passes. This sits
  // ON TOP of the role-on-task + SoD gates above — being the assignee never
  // bypasses them. Unassigned tasks (assigneeId NULL) keep the legacy
  // any-role-holder behaviour.
  const isAdminOverride = isSuperAdmin || ctx.roles.includes("workflow_admin");
  if (
    !isAdminOverride &&
    existing.assigneeId &&
    existing.assigneeId !== ctx.actorId &&
    !delegatorIds.has(existing.assigneeId)
  ) {
    throw new HttpError(403, "NOT_ASSIGNEE", "this task is assigned to another user");
  }

  // Segregation of duties (NON-AUTHORITATIVE fast-fail for UX only):
  //  (a) submitter may not approve their own request (self-approval);
  //  (b) an actor who completed a PRIOR step on this instance may not act on
  //      the current step (repeat-actor / four-eyes).
  // super_admin is exempt (break-glass) and the override is recorded + audited.
  // C2 — this pre-check is racy (completed_by is written later, by the consumer
  // transaction), so two concurrent completions both pass here. The DURABLE,
  // authoritative SoD enforcement now lives inside the consumer transaction
  // under a row lock (see consumer.ts). This block only short-circuits the
  // obvious self-approval case early for a friendlier error.
  if (!isSuperAdmin) {
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    // self-approval: by the actor directly, OR via a delegation whose delegator
    // is the submitter (the delegate is standing in for that role).
    if (instance && (instance.createdBy === ctx.actorId || delegatorIds.has(instance.createdBy))) {
      throw new HttpError(403, "SELF_APPROVAL_DENIED", "the submitter of a workflow may not approve their own request");
    }
    const priorTasks = await db.select().from(tasks)
      .where(and(
        eq(tasks.instanceId, existing.instanceId),
        eq(tasks.status, "completed"),
      ));
    // repeat-actor: a prior step completed by the actor directly OR by a
    // delegator the actor is now acting on behalf of (four-eyes via delegation).
    const conflict = priorTasks.some(
      (t) => t.completedBy != null && (t.completedBy === ctx.actorId || delegatorIds.has(t.completedBy)),
    );
    if (conflict) {
      throw new HttpError(403, "SOD_REPEAT_ACTOR", "you already acted on a prior step of this workflow");
    }
  } else {
    // record whether the super_admin is actually overriding a SoD conflict
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    const priorByActor = await db.select().from(tasks)
      .where(and(
        eq(tasks.instanceId, existing.instanceId),
        eq(tasks.status, "completed"),
        eq(tasks.completedBy, ctx.actorId),
      ));
    sodOverride = (instance?.createdBy === ctx.actorId) || priorByActor.length > 0;
  }

  const projected: TaskView = { ...existing, status: "completed", decision, version: existing.version + 1 };
  await cache.put(cache.makeKey(ctx.tenantId, TASK_RESOURCE, taskId), projected);
  await queue.publish(COMMANDS.completeTask, {
    // unique per action (a task may be completed again after a return/rework);
    // must be a UUID since the inbox dedup key (_inbox.processed.message_id) is uuid.
    messageId: randomUUID(),
    type: COMMANDS.completeTask,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...existing, decision, sodOverride },
  });

  return { id: taskId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * P1-1 — claim an UNASSIGNED task. The actor must be a role-holder for the
 * task's roleRef (or hold an active delegation) — they could already see it —
 * and the task must be pending and unclaimed. Claiming is synchronous (no
 * queue) because it's a single-row CAS that the UI needs an immediate answer
 * for. After this the task is assignee-locked to the actor.
 */
export async function claimTask(ctx: RequestContext, taskId: string): Promise<TaskView> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status !== "pending") throw new HttpError(409, "CONFLICT", "task is not pending");
  if (existing.assigneeId) {
    if (existing.assigneeId === ctx.actorId) return existing; // idempotent re-claim by self
    throw new HttpError(409, "ALREADY_CLAIMED", "task already claimed by another user");
  }

  const isSuperAdmin = ctx.roles.includes("super_admin");
  const activeDelegations = await delegationRepo.activeForDelegate(ctx.tenantId, ctx.actorId, today());
  const hasActiveDelegation = activeDelegations.length > 0;
  if (!isSuperAdmin && existing.roleRef && !ctx.roles.includes(existing.roleRef) && !hasActiveDelegation) {
    throw new HttpError(403, "ROLE_NOT_AUTHORIZED", `this task requires role '${existing.roleRef}'`);
  }

  const claimed = await repo.claim(taskId, ctx.tenantId, ctx.actorId);
  if (!claimed) throw new HttpError(409, "ALREADY_CLAIMED", "task already claimed by another user");
  await cache.put(cache.makeKey(ctx.tenantId, TASK_RESOURCE, taskId), claimed);
  await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);
  return claimed;
}

/**
 * P1-1 — assign a pending task to a specific user. Restricted to admins
 * (super_admin / workflow_admin) at the route. Overwrites any prior assignee.
 */
export async function assignTask(
  ctx: RequestContext,
  taskId: string,
  assigneeId: string,
  reassign = false,
): Promise<TaskView> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status !== "pending") throw new HttpError(409, "CONFLICT", "task is not pending");
  // SECURITY M-1 — do not silently overwrite an existing assignee. Overwriting a
  // non-null, different assignee requires an explicit reassign flag.
  if (existing.assigneeId && existing.assigneeId !== assigneeId && !reassign) {
    throw new HttpError(409, "ALREADY_ASSIGNED", "task already assigned; pass reassign=true to override");
  }
  const assigned = await db.transaction(async (tx) => {
    const res = await repo.assignTx(tx, taskId, ctx.tenantId, assigneeId, ctx.actorId);
    if (!res) throw new HttpError(409, "CONFLICT", "task could not be assigned (no longer pending)");
    // SECURITY M-1 — durable audit of every (re)assignment: actor + from->to
    // assignee, committed atomically with the assignment in the same tx.
    await historyRepo.record(tx, {
      tenantId: ctx.tenantId,
      instanceId: existing.instanceId,
      taskId,
      fromNode: existing.nodeKey ?? null,
      toNode: existing.nodeKey ?? null,
      action: res.priorAssigneeId ? "reassign" : "assign",
      decision: null,
      actorId: ctx.actorId,
      detail: { fromAssignee: res.priorAssigneeId, toAssignee: assigneeId },
    });
    return res.view;
  });
  await cache.put(cache.makeKey(ctx.tenantId, TASK_RESOURCE, taskId), assigned);
  await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);
  return assigned;
}

export type BulkResult = { id: string; ok: boolean; status?: string; code?: string; message?: string };

/**
 * P1-3 — bulk-complete. Iterates the per-task completeTask command so EVERY
 * existing gate (instance-active, role-on-task, SoD, assignee, optimistic lock)
 * still applies per task. Returns a per-id result; one task's failure never
 * aborts the others.
 */
export async function bulkComplete(
  ctx: RequestContext,
  taskIds: string[],
  decision: "approve" | "reject" | "return" = "approve",
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const id of taskIds) {
    try {
      const r = await completeTask(ctx, id, decision);
      results.push({ id, ok: true, status: r.status });
    } catch (err) {
      if (err instanceof HttpError) {
        results.push({ id, ok: false, code: err.code, message: err.message });
      } else {
        results.push({ id, ok: false, code: "INTERNAL", message: "internal error" });
      }
    }
  }
  return results;
}
