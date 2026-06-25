import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertTaskTransitionAllowed, assertMilestoneCanComplete } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerProjectConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.projectCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; code: string; name: string;
      schemeId?: string; agencyRef?: string; dprCostMinor?: number; sanctionedMinor?: number;
      sanctionRef?: string; startDate?: string; endDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProject(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        schemeId: p.schemeId ?? null, agencyRef: p.agencyRef ?? null,
        dprCostMinor: BigInt(p.dprCostMinor ?? 0),
        sanctionedMinor: BigInt(p.sanctionedMinor ?? 0),
        sanctionRef: p.sanctionRef ?? null,
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
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success" },
  });
}
