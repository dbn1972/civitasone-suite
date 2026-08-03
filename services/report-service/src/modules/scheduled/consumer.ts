/**
 * scheduled consumer — the ONLY code that writes scheduled_reports Postgres rows.
 */
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache, queue as defaultQueue } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ScheduledReportView } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const RESOURCE = "scheduled";
const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string): string {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerScheduledConsumers(queue: Queue, publishQueue: Queue = defaultQueue): void {
  queue = tenantScoped(queue);

  queue.subscribe<ScheduledReportView>(COMMANDS.createScheduled, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        templateId: p.templateId,
        cadence: p.cadence,
        recipients: p.recipients,
        format: p.format,
        enabled: p.enabled,
        nextRunAt: p.nextRunAt,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await enqueue(tx, {
        topic: EVENTS.scheduledCreated,
        eventType: EVENTS.scheduledCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, templateId: p.templateId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "reports",
          action: "create",
          resourceType: "scheduled_report",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ id: string; version: number; [key: string]: unknown }>(
    COMMANDS.updateScheduled,
    async (msg) => {
      const { id, version, ...updates } = msg.payload;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const success = await repo.update(tx, id, msg.tenantId, version, {
          ...updates,
          updatedBy: msg.actorId,
        } as Parameters<typeof repo.update>[4]);
        if (!success) return;
        await enqueue(tx, {
          topic: EVENTS.scheduledUpdated,
          eventType: EVENTS.scheduledUpdated,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { id },
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "reports",
            action: "update",
            resourceType: "scheduled_report",
            resourceId: id,
            outcome: "success",
          },
        });
      });
      await cache.invalidate(keyFor(msg.tenantId, id));
      await cache.invalidateResource(msg.tenantId, RESOURCE);
    },
  );

  queue.subscribe<{ id: string }>(COMMANDS.disableScheduled, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const success = await repo.disable(tx, msg.payload.id, msg.tenantId, msg.actorId);
      if (!success) return;
      await enqueue(tx, {
        topic: EVENTS.scheduledDisabled,
        eventType: EVENTS.scheduledDisabled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: msg.payload.id },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "reports",
          action: "disable",
          resourceType: "scheduled_report",
          resourceId: msg.payload.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{
    scheduledReportId: string;
    jobId: string;
    templateId: string;
    format: string;
  }>(COMMANDS.runScheduled, async (msg) => {
    const p = msg.payload;
    const now = new Date();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.touchLastRunAt(tx, p.scheduledReportId, msg.tenantId, msg.actorId, now);
      await enqueue(tx, {
        topic: EVENTS.scheduledGenerated,
        eventType: EVENTS.scheduledGenerated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { scheduledReportId: p.scheduledReportId, jobId: p.jobId },
      });
    });

    await cache.invalidate(keyFor(msg.tenantId, p.scheduledReportId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);

    await publishQueue.publish(COMMANDS.renderJob, {
      messageId: p.jobId,
      type: COMMANDS.renderJob,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId ?? randomUUID(),
      schemaVersion: "1.0",
      payload: {
        jobId: p.jobId,
        tenantId: msg.tenantId,
        templateId: p.templateId,
        format: p.format,
        scheduledReportId: p.scheduledReportId,
      },
    });
  });
}

export async function handleCreateScheduled(
  messageId: string,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: ScheduledReportView,
): Promise<void> {
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    await repo.insert(tx, {
      id: payload.id,
      tenantId: payload.tenantId,
      templateId: payload.templateId,
      cadence: payload.cadence,
      recipients: payload.recipients,
      format: payload.format,
      enabled: payload.enabled,
      nextRunAt: payload.nextRunAt,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    });
    await enqueue(tx, {
      topic: EVENTS.scheduledCreated,
      eventType: EVENTS.scheduledCreated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id, templateId: payload.templateId },
    });
  });
  await cache.invalidate(keyFor(ctx.tenantId, payload.id));
}

export async function handleUpdateScheduled(
  messageId: string,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: { id: string; version: number; [key: string]: unknown },
): Promise<void> {
  const { id, version, ...updates } = payload;
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    const success = await repo.update(tx, id, ctx.tenantId, version, {
      ...updates,
      updatedBy: ctx.actorId,
    } as Parameters<typeof repo.update>[4]);
    if (!success) return;
    await enqueue(tx, {
      topic: EVENTS.scheduledUpdated,
      eventType: EVENTS.scheduledUpdated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id },
    });
  });
  await cache.invalidate(keyFor(ctx.tenantId, id));
}

export async function handleDisableScheduled(
  messageId: string,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: { id: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    await repo.disable(tx, payload.id, ctx.tenantId, ctx.actorId);
    await enqueue(tx, {
      topic: EVENTS.scheduledDisabled,
      eventType: EVENTS.scheduledDisabled,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id },
    });
  });
  await cache.invalidate(keyFor(ctx.tenantId, payload.id));
}

export async function handleRunScheduled(
  messageId: string,
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: { scheduledReportId: string; jobId: string; templateId: string; format: string },
  publishQueue: Queue = defaultQueue,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await markProcessed(tx, messageId);
    await repo.touchLastRunAt(tx, payload.scheduledReportId, ctx.tenantId, ctx.actorId, now);
    await enqueue(tx, {
      topic: EVENTS.scheduledGenerated,
      eventType: EVENTS.scheduledGenerated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { scheduledReportId: payload.scheduledReportId, jobId: payload.jobId },
    });
  });
  await cache.invalidate(keyFor(ctx.tenantId, payload.scheduledReportId));

  await publishQueue.publish(COMMANDS.renderJob, {
    messageId: payload.jobId,
    type: COMMANDS.renderJob,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      jobId: payload.jobId,
      tenantId: ctx.tenantId,
      templateId: payload.templateId,
      format: payload.format,
      scheduledReportId: payload.scheduledReportId,
    },
  });
}
