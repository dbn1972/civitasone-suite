import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, TASK_RESOURCE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { tasks } from "./schema.js";
import * as instanceRepo from "../instances/repo.js";
import * as delegationRepo from "../delegations/repo.js";
import * as historyRepo from "../history/repo.js";
import type { TaskView } from "./schema.js";
import { checkMandatoryDocs } from "./doc-gate.js";
import { isStrictSodRefType } from "./sod.js";
import { todayIST } from "../../shared/dates.js";
import { fetchUserDisplayName } from "../../shared/identity-client.js";
import { resolvePeople } from "../../shared/people-client.js";

/**
 * UAT follow-up (F108, security): a task with no roleRef used to be completable
 * (and claimable) by ANY workflow role-holder who knew its id: only the list was
 * scoped. Now only its assignee (or a delegate standing in for the assignee),
 * workflow_admin or super_admin may act on it. Anyone else gets 403
 * TASK_NOT_AUTHORIZED, and the refusal is audited: a "blocked" row in the
 * append-only transition history plus an audit.event.record outbox event, in
 * one transaction. Tasks WITH a roleRef keep the role-on-task gate.
 */
export const UNRESTRICTED_TASK_ADMIN_ROLES: readonly string[] = ["super_admin", "workflow_admin"];

async function refuseUnrestrictedTask(ctx: RequestContext, task: TaskView, op: "complete" | "claim", decision: string | null): Promise<never> {
  await db.transaction(async (tx) => {
    await historyRepo.record(tx, {
      tenantId: ctx.tenantId,
      instanceId: task.instanceId,
      taskId: task.id,
      fromNode: task.nodeKey ?? null,
      toNode: null,
      action: "blocked",
      decision,
      actorId: ctx.actorId,
      detail: { reason: "unrestricted_task_not_authorized", op },
    });
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { service: "workflow", action: `task.${op}.denied`, resourceType: "workflow_task", resourceId: task.id, outcome: "denied", reason: "TASK_NOT_AUTHORIZED" },
    });
  });
  throw new HttpError(403, "TASK_NOT_AUTHORIZED", "this task has no role; only its assignee or a workflow admin may act on it");
}

/** YYYY-MM-DD in IST (Asia/Kolkata), used to bound active-delegation validity. */
function today(): string {
  return todayIST();
}

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * UAT T-EDGE TE-08: the losing checker of a parallel approval was told 202 "accepted". A task that
 * is already decided is now a synchronous 409 TASK_ALREADY_DECIDED that names who decided it and
 * how (the web shows it in en/hi). The consumer lock stays the final guard for a true race (and
 * now tells the late checker too, see tasks/consumer.ts notifyLateDecision).
 */
export async function taskAlreadyDecided(tenantId: string, taskId: string, decision: string | null | undefined): Promise<HttpError> {
  const row = await repo.findDecisionById(taskId, tenantId);
  const deciderId = row?.completedBy ?? null;
  const name = deciderId ? ((await resolvePeople(tenantId, [deciderId])).get(deciderId)?.name ?? await fetchUserDisplayName(tenantId, deciderId)) : null;
  const how = row?.decision ?? decision ?? "completed";
  return new HttpError(409, "TASK_ALREADY_DECIDED", `this task was already decided (${how})${name ? ` by ${name}` : ""}`, {
    decision: how,
    decidedBy: deciderId ? { id: deciderId, name } : null,
    decidedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  });
}

export async function completeTask(
  ctx: RequestContext,
  taskId: string,
  decision: "approve" | "reject" | "return" = "approve",
  reason?: string,
): Promise<Accepted> {
  const existing = await repo.findById(taskId, ctx.tenantId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "task not found");

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
  // Only delegations that explicitly convey THIS task's roleRef may stand in for
  // the role, AND whose delegator STILL holds it in identity-service right now
  // (use-time check, fail closed). Resolved lazily: only when the role gate or the
  // assignee lock actually needs a delegation. A task with no roleRef is
  // unrestricted, so every active delegation counts.
  let liveRoleDelegations: Awaited<ReturnType<typeof delegationRepo.liveRoleDelegations>> | undefined;
  const roleDelegationsFor = async () => {
    liveRoleDelegations ??= existing.roleRef
      ? await delegationRepo.liveRoleDelegations(ctx.tenantId, activeDelegations, existing.roleRef)
      : activeDelegations;
    return liveRoleDelegations;
  };

  // C1 — role-on-task authorization. The broad requireRole() gate at the route
  // only proves the actor holds *some* workflow role; it never checks the
  // actor's roles against THIS task's roleRef. Without this, any tenant user
  // with any workflow role could complete any task regardless of refType
  // (the route's permission if-chain leaves estab_file/asset_disposal/etc with
  // no gate at all). Rule: unless super_admin (break-glass), the actor must
  // hold the task's roleRef. A task with no roleRef is unrestricted.
  // A delegate may pass the gate ONLY via an active delegation naming them that
  // explicitly conveys this roleRef (the delegator was verified to hold it when
  // the delegation was created). A delegation for some other role, or a legacy
  // delegation with no role scope, never satisfies it.
  if (!isSuperAdmin && existing.roleRef && !ctx.roles.includes(existing.roleRef) && (await roleDelegationsFor()).length === 0) {
    throw new HttpError(403, "ROLE_NOT_AUTHORIZED", `this task requires role '${existing.roleRef}'`);
  }
  // UAT follow-up (F108): a task with no roleRef is no longer open to everyone.
  if (!existing.roleRef && !ctx.roles.some((r) => UNRESTRICTED_TASK_ADMIN_ROLES.includes(r))) {
    const isAssigneeOrDelegate = existing.assigneeId != null && (
      existing.assigneeId === ctx.actorId ||
      (await roleDelegationsFor()).some((d) => d.delegatorId === existing.assigneeId)
    );
    if (!isAssigneeOrDelegate) await refuseUnrestrictedTask(ctx, existing, "complete", decision);
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
    !(await roleDelegationsFor()).some((d) => d.delegatorId === existing.assigneeId)
  ) {
    throw new HttpError(403, "NOT_ASSIGNEE", "this task is assigned to another user");
  }

  // BLOCKER 1 (PR #2465 review): the already-decided 409 names who decided, so it must sit BEHIND the
  // role-on-task, F108 and assignee gates above - a caller who fails them gets 403/404, never the decider.
  // It still precedes the call-task / instance-active checks and SoD (a decided task's instance is usually
  // no longer active, and the decider would trip SOD_REPEAT_ACTOR on their own completed task).
  if (existing.status === "completed") throw await taskAlreadyDecided(ctx.tenantId, taskId, existing.decision);
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
  // W4: the maker's "correct and resubmit" task is not a checker decision, so maker-checker SoD
  // does not apply to it - but it can only be resubmitted (approve), never rejected or returned.
  const isRework = typeof existing.nodeKey === "string" && existing.nodeKey.startsWith("rework:");
  if (isRework && decision !== "approve") {
    throw new HttpError(422, "REWORK_RESUBMIT_ONLY", "a returned item can only be corrected and resubmitted");
  }
  if (isRework) {
    // fall through: role / assignee gates above already confined this to the maker
  } else if (!isSuperAdmin) {
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    // self-approval: by the actor directly, OR via a delegation whose delegator
    // is the submitter (the delegate is standing in for that role).
    if (instance && (instance.createdBy === ctx.actorId || delegatorIds.has(instance.createdBy))) {
      throw new HttpError(403, "SELF_APPROVAL_DENIED", "the submitter of a workflow may not approve their own request");
    }
    const priorTasks = await scopedRead((tx) => tx.select().from(tasks)
      .where(and(
        eq(tasks.instanceId, existing.instanceId),
        eq(tasks.status, "completed"),
      )));
    // repeat-actor: a prior step completed by the actor directly OR by a
    // delegator the actor is now acting on behalf of (four-eyes via delegation).
    const conflict = priorTasks.some(
      (t) => t.decision !== "return" && t.completedBy != null && (t.completedBy === ctx.actorId || delegatorIds.has(t.completedBy)),
    );
    if (conflict) {
      throw new HttpError(403, "SOD_REPEAT_ACTOR", "you already acted on a prior step of this workflow");
    }
  } else {
    // record whether the super_admin is actually overriding a SoD conflict
    const instance = await instanceRepo.findByIdFull(existing.instanceId, ctx.tenantId);
    // F102: no break-glass for the initiator of a maker-checker approval whose
    // domain refuses self-approval anyway - consuming the task here would leave
    // the record pending with no open task.
    if (instance && isStrictSodRefType(instance.refType ?? existing.refType)
        && (instance.createdBy === ctx.actorId || delegatorIds.has(instance.createdBy))) {
      throw new HttpError(403, "SOD_SELF_APPROVAL", "the initiator of a maker-checker approval may not complete it, even as super_admin");
    }
    const priorByActor = await scopedRead((tx) => tx.select().from(tasks)
      .where(and(
        eq(tasks.instanceId, existing.instanceId),
        eq(tasks.status, "completed"),
        eq(tasks.completedBy, ctx.actorId),
      )));
    sodOverride = (instance?.createdBy === ctx.actorId) || priorByActor.length > 0;
  }

  // GAP-WORKFLOW-INSTANCES-DETAIL-02 — an APPROVAL of an application-bound
  // officer task is refused while the lane checklist has missing mandatory
  // documents (or cannot be read: fail closed). Reject/return are not gated.
  // The refusal is audited in the append-only transition history. The consumer
  // re-checks (authoritative for a command that bypassed this route).
  if (decision === "approve" && !isRework) {
    const gate = await checkMandatoryDocs(ctx.tenantId, existing);
    if (!gate.ok) {
      await db.transaction(async (tx) => {
        await historyRepo.record(tx, {
          tenantId: ctx.tenantId,
          instanceId: existing.instanceId,
          taskId,
          fromNode: existing.nodeKey ?? null,
          toNode: null,
          action: "blocked",
          decision,
          actorId: ctx.actorId,
          detail: gate.reason === "missing"
            ? { reason: "mandatory_documents_missing", missingMandatory: gate.missingMandatory }
            : { reason: "document_check_unavailable" },
        });
      });
      if (gate.reason === "missing") {
        throw new HttpError(409, "MANDATORY_DOCUMENTS_MISSING", "mandatory documents are missing; the task cannot be approved");
      }
      throw new HttpError(503, "DOCUMENT_CHECK_UNAVAILABLE", "the mandatory-document checklist could not be verified; try again");
    }
  }

  // UAT #2445 delta review item 3: the delegations this check relied on, so the
  // consumer can re-verify under the lock that they are still active.
  const viaRoleDelegation = !isSuperAdmin && !!existing.roleRef && !ctx.roles.includes(existing.roleRef);
  const roleDelegationIds = viaRoleDelegation ? (await roleDelegationsFor()).map((d) => d.id) : [];
  const viaAssigneeDelegation = !isAdminOverride && !!existing.assigneeId && existing.assigneeId !== ctx.actorId;
  const assigneeDelegationIds = viaAssigneeDelegation
    ? (await roleDelegationsFor()).filter((d) => d.delegatorId === existing.assigneeId).map((d) => d.id)
    : [];

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
    // UAT #2445 review item 5: what the consumer re-checks under the row lock.
    payload: { ...existing, decision, sodOverride, ...(reason ? { reason } : {}), authz: { roles: ctx.roles, assigneeAtCheck: existing.assigneeId ?? null, roleDelegationIds, assigneeDelegationIds } },
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
  // Same scoped rule as completeTask: the delegation must convey this roleRef.
  // The delegator must also STILL hold the role (live identity lookup, fail closed).
  if (
    !isSuperAdmin && existing.roleRef && !ctx.roles.includes(existing.roleRef) &&
    (await delegationRepo.liveRoleDelegations(ctx.tenantId, activeDelegations, existing.roleRef)).length === 0
  ) {
    throw new HttpError(403, "ROLE_NOT_AUTHORIZED", `this task requires role '${existing.roleRef}'`);
  }
  // UAT follow-up (F108): an unassigned task with no roleRef is not claimable by
  // any role-holder; a workflow admin triages and assigns it.
  if (!existing.roleRef && !ctx.roles.some((r) => UNRESTRICTED_TASK_ADMIN_ROLES.includes(r))) {
    await refuseUnrestrictedTask(ctx, existing, "claim", null);
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
