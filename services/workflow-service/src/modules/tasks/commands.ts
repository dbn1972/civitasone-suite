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

  // C1 — role-on-task authorization. The broad requireRole() gate at the route
  // only proves the actor holds *some* workflow role; it never checks the
  // actor's roles against THIS task's roleRef. Without this, any tenant user
  // with any workflow role could complete any task regardless of refType
  // (the route's permission if-chain leaves estab_file/asset_disposal/etc with
  // no gate at all). Rule: unless super_admin (break-glass), the actor must
  // hold the task's roleRef. A task with no roleRef is unrestricted.
  if (!isSuperAdmin && existing.roleRef && !ctx.roles.includes(existing.roleRef)) {
    throw new HttpError(403, "ROLE_NOT_AUTHORIZED", `this task requires role '${existing.roleRef}'`);
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
