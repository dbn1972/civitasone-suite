import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import * as historyRepo from "../history/repo.js";
import * as taskRepo from "../tasks/repo.js";
import { TASK_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { taskForwards, type TaskForwardRow } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Forward a pending task to another user. The current assignee (or actor if
 * unassigned) becomes from_user; the task's assignee_id is updated to toUserId.
 */
export async function forwardTask(
  ctx: RequestContext,
  taskId: string,
  toUserId: string,
  remarks?: string,
): Promise<Accepted> {
  const existing = await taskRepo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status !== "pending") throw new HttpError(409, "CONFLICT", "task is not pending");

  const fromUser = existing.assigneeId ?? ctx.actorId;
  const correlationId = randomUUID();

  // Assign the task to the target user
  const assigned = await taskRepo.assign(taskId, ctx.tenantId, toUserId, ctx.actorId);
  if (!assigned) throw new HttpError(409, "CONFLICT", "task assignment failed (concurrent update)");

  // Record the forward
  await db.transaction(async (tx) => {
    await tx.insert(taskForwards).values({
      tenantId: ctx.tenantId,
      taskId,
      instanceId: existing.instanceId,
      fromUser,
      toUser: toUserId,
      remarks: remarks ?? null,
      action: "forward",
    });
  });

  // Audit trail in transition_history
  await historyRepo.record(db, {
    tenantId: ctx.tenantId,
    instanceId: existing.instanceId,
    taskId,
    fromNode: existing.nodeKey ?? null,
    toNode: existing.nodeKey ?? null,
    action: "forward",
    decision: null,
    actorId: ctx.actorId,
    detail: { fromUser, toUser: toUserId, remarks: remarks ?? null },
  });

  // Invalidate cached task
  await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);

  return { id: taskId, status: "accepted", correlationId };
}

/**
 * Recall a previously forwarded task. The actor must be the original from_user
 * of the last forward (or an admin). The task's assignee_id reverts to the actor.
 */
export async function recallTask(
  ctx: RequestContext,
  taskId: string,
  remarks?: string,
): Promise<Accepted> {
  const existing = await taskRepo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status !== "pending") throw new HttpError(409, "CONFLICT", "task is not pending");

  // Verify actor is the from_user of the last forward or is an admin
  const lastForward = await scopedRead((tx) => tx.select().from(taskForwards)
    .where(and(
      eq(taskForwards.taskId, taskId),
      eq(taskForwards.tenantId, ctx.tenantId),
      eq(taskForwards.action, "forward"),
    ))
    .orderBy(desc(taskForwards.createdAt))
    .limit(1));

  const isAdmin = ctx.roles.includes("workflow_admin") || ctx.roles.includes("super_admin");

  if (!lastForward[0]) {
    throw new HttpError(409, "NO_FORWARD", "no forward record found for this task");
  }
  if (lastForward[0].fromUser !== ctx.actorId && !isAdmin) {
    throw new HttpError(403, "FORBIDDEN", "only the original forwarder or an admin can recall");
  }

  const correlationId = randomUUID();

  // Re-assign to the actor (the original forwarder)
  const assigned = await taskRepo.assign(taskId, ctx.tenantId, ctx.actorId, ctx.actorId);
  if (!assigned) throw new HttpError(409, "CONFLICT", "task assignment failed (concurrent update)");

  // Record the recall
  await db.transaction(async (tx) => {
    await tx.insert(taskForwards).values({
      tenantId: ctx.tenantId,
      taskId,
      instanceId: existing.instanceId,
      fromUser: existing.assigneeId ?? ctx.actorId,
      toUser: ctx.actorId,
      remarks: remarks ?? null,
      action: "recall",
    });
  });

  // Audit trail in transition_history
  await historyRepo.record(db, {
    tenantId: ctx.tenantId,
    instanceId: existing.instanceId,
    taskId,
    fromNode: existing.nodeKey ?? null,
    toNode: existing.nodeKey ?? null,
    action: "recall",
    decision: null,
    actorId: ctx.actorId,
    detail: { recalledFrom: existing.assigneeId, remarks: remarks ?? null },
  });

  // Invalidate cached task
  await cache.invalidateResource(ctx.tenantId, TASK_RESOURCE);

  return { id: taskId, status: "accepted", correlationId };
}

/**
 * List all forward/recall records for a task, ordered by created_at descending.
 */
export async function listForwards(taskId: string, tenantId: string): Promise<TaskForwardRow[]> {
  return scopedRead((tx) => tx.select().from(taskForwards)
    .where(and(eq(taskForwards.taskId, taskId), eq(taskForwards.tenantId, tenantId)))
    .orderBy(desc(taskForwards.createdAt)));
}
