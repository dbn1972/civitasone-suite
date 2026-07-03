/**
 * Scheduled Jobs consumer — the ONLY code that writes Postgres for scheduled jobs.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { scheduledJobs, jobExecutionHistory } from "./schema.js";
import { eq, and } from "drizzle-orm";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "scheduled_job";

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerScheduledJobConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; name: string; description: string;
    cronExpression: string; timezone: string; targetService: string;
    targetCommand: string; payload: Record<string, unknown>; enabled: boolean;
  }>(COMMANDS.scheduledJobCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).insert(scheduledJobs).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        cronExpression: p.cronExpression,
        timezone: p.timezone,
        targetService: p.targetService,
        targetCommand: p.targetCommand,
        payload: p.payload,
        enabled: p.enabled,
        lastRunStatus: "never_run",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, "admin.scheduled_job.created", p, "create", p.id);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{
    jobId: string; tenantId: string; name?: string; description?: string;
    cronExpression?: string; timezone?: string; targetService?: string;
    targetCommand?: string; payload?: Record<string, unknown>; enabled?: boolean;
  }>(COMMANDS.scheduledJobUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const updates: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
      if (p.name !== undefined) updates.name = p.name;
      if (p.description !== undefined) updates.description = p.description;
      if (p.cronExpression !== undefined) updates.cronExpression = p.cronExpression;
      if (p.timezone !== undefined) updates.timezone = p.timezone;
      if (p.targetService !== undefined) updates.targetService = p.targetService;
      if (p.targetCommand !== undefined) updates.targetCommand = p.targetCommand;
      if (p.payload !== undefined) updates.payload = p.payload;
      if (p.enabled !== undefined) updates.enabled = p.enabled;
      await (tx as any).update(scheduledJobs).set(updates)
        .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)));
      await emit(tx, msg, "admin.scheduled_job.updated", p, "update", p.jobId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ jobId: string; tenantId: string }>(COMMANDS.scheduledJobDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).delete(scheduledJobs)
        .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)));
      await emit(tx, msg, "admin.scheduled_job.deleted", p, "delete", p.jobId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ jobId: string; tenantId: string }>(COMMANDS.scheduledJobRunNow, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const executionId = crypto.randomUUID();
      await (tx as any).insert(jobExecutionHistory).values({
        id: executionId,
        tenantId: p.tenantId,
        jobId: p.jobId,
        startedAt: new Date(),
        status: "running",
      });
      await (tx as any).update(scheduledJobs).set({ lastRunAt: new Date(), lastRunStatus: "running", updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)));
      await emit(tx, msg, "admin.scheduled_job.run_triggered", { ...p, executionId }, "run_now", p.jobId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ jobId: string; tenantId: string }>(COMMANDS.scheduledJobPause, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).update(scheduledJobs).set({ enabled: false, updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)));
      await emit(tx, msg, "admin.scheduled_job.paused", p, "pause", p.jobId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });

  queue.subscribe<{ jobId: string; tenantId: string }>(COMMANDS.scheduledJobResume, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await (tx as any).update(scheduledJobs).set({ enabled: true, updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)));
      await emit(tx, msg, "admin.scheduled_job.resumed", p, "resume", p.jobId);
    });
    await cache.invalidate(listKey(msg.payload.tenantId));
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
