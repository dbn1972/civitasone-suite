import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "field.tasks.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

function invalidateTask(tenantId: string, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(tenantId, "task", id));
}

export function registerTaskConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.taskCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      assigneeId: string | null;
      taskType: string;
      title: string;
      description: string | null;
      status: string;
      priority: number;
      latitude: string | null;
      longitude: string | null;
      address: string | null;
      dueDate: string | null;
      metadata: Record<string, unknown> | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        assigneeId: p.assigneeId,
        taskType: p.taskType,
        title: p.title,
        description: p.description,
        status: p.status,
        priority: p.priority,
        latitude: p.latitude,
        longitude: p.longitude,
        address: p.address,
        dueDate: p.dueDate ? new Date(p.dueDate) : null,
        metadata: p.metadata,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.taskCreated,
        eventType: EVENTS.taskCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id, taskType: p.taskType, assigneeId: p.assigneeId, status: p.status },
      });
      await writeAudit(tx, ctxOf(msg), { action: "task.create", resourceType: "field_task", resourceId: p.id });
    });
    log.info({ id: p.id }, "task created");
  });

  queue.subscribe(COMMANDS.taskUpdate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number; patch: Record<string, unknown> };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, p.patch, p.version);
      if (!ok) return;
      applied = true;
      await writeAudit(tx, ctxOf(msg), {
        action: "task.update",
        resourceType: "field_task",
        resourceId: p.id,
        details: { fields: Object.keys(p.patch) },
      });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.taskAssign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assigneeId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { assigneeId: p.assigneeId, status: "assigned", updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.taskAssigned,
        eventType: EVENTS.taskAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id, assigneeId: p.assigneeId },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "task.assign",
        resourceType: "field_task",
        resourceId: p.id,
        details: { assigneeId: p.assigneeId },
      });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.taskStart, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(tx, p.id, msg.tenantId, { status: "in_progress", updatedBy: msg.actorId }, p.version);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.taskStarted,
        eventType: EVENTS.taskStarted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "task.start", resourceType: "field_task", resourceId: p.id });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.taskComplete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    const completedAt = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { status: "completed", completedAt, updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.taskCompleted,
        eventType: EVENTS.taskCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id, completedAt: completedAt.toISOString() },
      });
      await writeAudit(tx, ctxOf(msg), { action: "task.complete", resourceType: "field_task", resourceId: p.id });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.taskCancel, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { status: "cancelled", cancelledAt: new Date(), updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.taskCancelled,
        eventType: EVENTS.taskCancelled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "task.cancel", resourceType: "field_task", resourceId: p.id });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });

  queue.subscribe(COMMANDS.taskDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; version: number };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.update(
        tx,
        p.id,
        msg.tenantId,
        { status: "cancelled", cancelledAt: new Date(), updatedBy: msg.actorId },
        p.version,
      );
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.taskDeleted,
        eventType: EVENTS.taskDeleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { taskId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), { action: "task.delete", resourceType: "field_task", resourceId: p.id });
    });
    if (applied) await invalidateTask(msg.tenantId, p.id);
  });
}
