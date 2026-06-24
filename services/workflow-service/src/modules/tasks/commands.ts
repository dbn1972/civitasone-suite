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
import type { TaskView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function completeTask(
  ctx: RequestContext,
  taskId: string,
  decision: "approve" | "reject" | "return" = "approve",
): Promise<Accepted> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");
  if (existing.status === "completed") throw new HttpError(409, "CONFLICT", "task already completed");

  const isSuperAdmin = ctx.roles.includes("super_admin");
  let sodOverride = false;

  // Segregation of duties:
  //  (a) submitter may not approve their own request (self-approval);
  //  (b) an actor who completed a PRIOR step on this instance may not act on
  //      the current step (repeat-actor / four-eyes).
  // super_admin is exempt (break-glass) and the override is recorded + audited.
  if (!isSuperAdmin) {
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    if (instance && instance.createdBy === ctx.actorId) {
      throw new HttpError(403, "SELF_APPROVAL_DENIED", "the submitter of a workflow may not approve their own request");
    }
    const priorByActor = await db.select().from(tasks)
      .where(and(
        eq(tasks.instanceId, existing.instanceId),
        eq(tasks.status, "completed"),
        eq(tasks.completedBy, ctx.actorId),
      ));
    if (priorByActor.length > 0) {
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
