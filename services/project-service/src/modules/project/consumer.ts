import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { projectMembers, type ProjectInsert } from "./schema.js";
import { and, eq } from "drizzle-orm";
import { assertTaskTransitionAllowed, assertMilestoneCanComplete } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerProjectConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe(COMMANDS.projectCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string;
      schemeId?: string; agencyRef?: string; dprCostMinor?: number; sanctionedMinor?: number;
      sanctionRef?: string; startDate?: string; endDate?: string; costCenterId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProject(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        schemeId: p.schemeId ?? null, agencyRef: p.agencyRef ?? null,
        dprCostMinor: BigInt(p.dprCostMinor ?? 0),
        sanctionedMinor: BigInt(p.sanctionedMinor ?? 0),
        sanctionRef: p.sanctionRef ?? null, costCenterId: p.costCenterId ?? null,
        startDate: p.startDate ?? null, endDate: p.endDate ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.projectCreated, eventType: EVENTS.projectCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { projectId: p.id, code: p.code, name: p.name, schemeId: p.schemeId ?? null },
      });
      await audit(tx, msg, "create", "project", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.id));
  });

  queue.subscribe(COMMANDS.taskCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; name: string;
      description?: string; parentTaskId?: string; weightPct?: number;
      plannedStart?: string; plannedEnd?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTask(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        parentTaskId: p.parentTaskId ?? null, name: p.name,
        description: p.description ?? null, weightPct: String(p.weightPct ?? 0),
        plannedStart: p.plannedStart ?? null, plannedEnd: p.plannedEnd ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.taskCreated, eventType: EVENTS.taskCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { taskId: p.id, projectId: p.projectId },
      });
      await audit(tx, msg, "create", "task", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  queue.subscribe(COMMANDS.taskStatusUpdate, async (msg) => {
    const p = msg.payload as { taskId: string; tenantId: string; projectId: string; status: string; progressPct?: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const task = await repo.findTaskByIdTx(tx, p.taskId, p.tenantId);
      if (!task) throw new Error(`task ${p.taskId} not found`);
      // A status command may only touch a task of the project it names.
      if (task.projectId !== p.projectId) throw new Error(`task ${p.taskId} does not belong to project ${p.projectId}`);
      assertTaskTransitionAllowed(task.status ?? "pending", p.status);
      await repo.updateTaskTx(tx, p.taskId, {
        status: p.status,
        progressPct: String(p.progressPct ?? (p.status === "completed" ? 100 : undefined) ?? Number(task.progressPct)),
        updatedBy: msg.actorId,
        version: (task.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.taskStatusUpdated, eventType: EVENTS.taskStatusUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { taskId: p.taskId, status: p.status, projectId: p.projectId },
      });
      await audit(tx, msg, "status_update", "task", p.taskId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  queue.subscribe(COMMANDS.milestoneCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; name: string;
      plannedDate: string; paymentMinor?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertMilestone(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        name: p.name, plannedDate: p.plannedDate,
        paymentMinor: BigInt(p.paymentMinor ?? 0),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "milestone", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  queue.subscribe(COMMANDS.milestoneComplete, async (msg) => {
    const p = msg.payload as { mId: string; tenantId: string; projectId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const milestone = await repo.findMilestoneByIdTx(tx, p.mId, p.tenantId);
      if (!milestone) throw new Error(`milestone ${p.mId} not found`);
      assertMilestoneCanComplete(milestone.status ?? "pending");
      const today = new Date().toISOString().split("T")[0]!;
      await repo.updateMilestoneTx(tx, p.mId, {
        status: "completed", actualDate: today,
        updatedBy: msg.actorId, version: (milestone.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.milestoneCompleted, eventType: EVENTS.milestoneCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { milestoneId: p.mId, projectId: p.projectId, name: milestone.name },
      });
      await audit(tx, msg, "complete", "milestone", p.mId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  // ─── Project Update ────────────────────────────────────────────────────────

  queue.subscribe(COMMANDS.projectUpdate, async (msg) => {
    const p = msg.payload as {
      projectId: string; tenantId: string;
      name?: string; agencyRef?: string; startDate?: string; endDate?: string;
      sanctionedMinor?: number; dprCostMinor?: number; sanctionRef?: string; status?: string;
      costCenterId?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const patch: Partial<ProjectInsert> = { updatedBy: msg.actorId };
      if (p.name !== undefined)            patch.name = p.name;
      if (p.agencyRef !== undefined)       patch.agencyRef = p.agencyRef;
      if (p.startDate !== undefined)       patch.startDate = p.startDate;
      if (p.endDate !== undefined)         patch.endDate = p.endDate;
      if (p.sanctionedMinor !== undefined) patch.sanctionedMinor = BigInt(p.sanctionedMinor);
      if (p.dprCostMinor !== undefined)    patch.dprCostMinor = BigInt(p.dprCostMinor);
      if (p.sanctionRef !== undefined)     patch.sanctionRef = p.sanctionRef;
      if (p.status !== undefined)          patch.status = p.status;
      if (p.costCenterId !== undefined)    patch.costCenterId = p.costCenterId;
      await repo.updateProjectTx(tx, p.projectId, p.tenantId, patch);
      await audit(tx, msg, "update", "project", p.projectId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  // ─── Task Update (full, not just status) ──────────────────────────────────

  queue.subscribe(COMMANDS.taskUpdate, async (msg) => {
    const p = msg.payload as {
      taskId: string; projectId: string; tenantId: string;
      name?: string; description?: string; parentTaskId?: string | null;
      weightPct?: number; plannedStart?: string; plannedEnd?: string;
      assigneeId?: string | null; progressPct?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const task = await repo.findTaskByIdTx(tx, p.taskId, p.tenantId);
      if (!task) throw new Error("task " + p.taskId + " not found");
      const patch: Partial<Parameters<typeof repo.updateTaskTx>[2]> = { updatedBy: msg.actorId };
      if (p.name !== undefined)         patch.name = p.name;
      if (p.description !== undefined)  patch.description = p.description;
      if (p.parentTaskId !== undefined) patch.parentTaskId = p.parentTaskId;
      if (p.weightPct !== undefined)    patch.weightPct = String(p.weightPct);
      if (p.plannedStart !== undefined) patch.plannedStart = p.plannedStart;
      if (p.plannedEnd !== undefined)   patch.plannedEnd = p.plannedEnd;
      if (p.progressPct !== undefined)  patch.progressPct = String(p.progressPct);
      patch.version = (task.version ?? 1) + 1;
      await repo.updateTaskTx(tx, p.taskId, patch);
      await enqueue(tx, {
        topic: EVENTS.taskUpdated, eventType: EVENTS.taskUpdated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { taskId: p.taskId, projectId: p.projectId },
      });
      await audit(tx, msg, "update", "task", p.taskId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  // ─── Member Add ─────────────────────────────────────────────────────────────

  queue.subscribe(COMMANDS.memberAdd, async (msg) => {
    const p = msg.payload as { id: string; projectId: string; tenantId: string; userId?: string | null; employeeId?: string | null; role: string; actorRoles?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Defence in depth for a command that skipped the route: appointing a manager is a manager / super admin act, never one's own.
      if (p.role === "project_manager" && !(await mayAppointManager(tx, msg, p.projectId, p.userId ?? null, isSuperAdmin(p.actorRoles)))) {
        await audit(tx, msg, "member_add_denied", "member", p.id, { role: p.role, projectId: p.projectId }, "failure");
        return;
      }
      await repo.insertMember(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        userId: p.userId ?? null, employeeId: p.employeeId ?? null, role: p.role,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "add", "member", p.id, { role: p.role, projectId: p.projectId, userId: p.userId ?? null, employeeId: p.employeeId ?? null });
    });
  });

  // ─── Member role change (S8 G7) ─────────────────────────────────────────────

  queue.subscribe(COMMANDS.memberRoleChange, async (msg) => {
    const p = msg.payload as { memberId: string; projectId: string; tenantId: string; role: string; actorRoles?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const member = await repo.findMemberByIdTx(tx, p.memberId, p.tenantId);
      if (!member || member.projectId !== p.projectId) { await audit(tx, msg, "member_role_change_denied", "member", p.memberId, { reason: "NOT_FOUND" }, "failure"); return; }
      if (member.userId && member.userId === msg.actorId) {
        await audit(tx, msg, "member_role_change_denied", "member", p.memberId, { reason: "SELF_ROLE_CHANGE", from: member.role, to: p.role }, "failure");
        return;
      }
      const touchesManager = p.role === "project_manager" || member.role === "project_manager";
      if (touchesManager && (p.role === "project_manager" && !member.userId
        || !(await mayAppointManager(tx, msg, p.projectId, member.userId ?? null, isSuperAdmin(p.actorRoles))))) {
        await audit(tx, msg, "member_role_change_denied", "member", p.memberId, { reason: "MANAGER_GRANT_FORBIDDEN", from: member.role, to: p.role }, "failure");
        return;
      }
      await repo.updateMemberRoleTx(tx, p.memberId, p.tenantId, p.role, msg.actorId);
      await audit(tx, msg, "role_change", "member", p.memberId, { projectId: p.projectId, from: member.role, to: p.role, userId: member.userId, employeeId: member.employeeId });
    });
  });

  // ─── Member Remove ──────────────────────────────────────────────────────────

  queue.subscribe(COMMANDS.memberRemove, async (msg) => {
    const p = msg.payload as { memberId: string; projectId: string; tenantId: string; actorRoles?: string[] };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const member = await repo.findMemberByIdTx(tx, p.memberId, p.tenantId);
      if (!member || member.projectId !== p.projectId) { await audit(tx, msg, "member_remove_denied", "member", p.memberId, { reason: "NOT_FOUND", projectId: p.projectId }, "failure"); return; }
      if (member.role === "project_manager") {
        const managers = await (tx as typeof db).select().from(projectMembers)
          .where(and(eq(projectMembers.projectId, p.projectId), eq(projectMembers.tenantId, p.tenantId), eq(projectMembers.role, "project_manager")));
        const allowed = await mayAppointManager(tx, msg, p.projectId, member.userId ?? null, isSuperAdmin(p.actorRoles));
        if (!allowed || managers.length <= 1) {
          await audit(tx, msg, "member_remove_denied", "member", p.memberId, { reason: !allowed ? "MANAGER_REMOVE_FORBIDDEN" : "LAST_MANAGER", projectId: p.projectId }, "failure");
          return;
        }
      }
      await repo.deleteMemberTx(tx, p.memberId, p.tenantId);
      await audit(tx, msg, "remove", "member", p.memberId, { projectId: p.projectId, role: member.role, userId: member.userId, employeeId: member.employeeId });
    });
  });

}

/** `super_admin` is read from the roles the route stamped from the caller's verified token (the same convention admin-service commands use), not from a boolean the sender chose. */
function isSuperAdmin(actorRoles: string[] | undefined): boolean {
  return Array.isArray(actorRoles) && actorRoles.includes("super_admin");
}

/**
 * Re-check of "may appoint a project manager" in the consumer. The facts that live in this service's database
 * (the actor's membership and role on THIS project, that the target is not the actor, the last-manager count)
 * are decided here from the data. The super_admin claim cannot be re-read from the database (roles live in the
 * token), so it comes from the roles the route stamped from the verified token - defence in depth against a
 * command that skipped the route's checks, not an independent proof of identity.
 */
async function mayAppointManager(tx: any, msg: any, projectId: string, targetUserId: string | null, isSuper: boolean): Promise<boolean> {
  if (targetUserId && targetUserId === msg.actorId) return false;
  if (isSuper) return true;
  const rows = await (tx as typeof db).select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, msg.actorId), eq(projectMembers.tenantId, msg.tenantId))).limit(1);
  return rows[0]?.role === "project_manager";
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string, details?: Record<string, unknown>, outcome: "success" | "failure" = "success"): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { ...(details ?? {}), service: "project", action, resourceType, resourceId, outcome },
  });
}
