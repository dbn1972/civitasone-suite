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
