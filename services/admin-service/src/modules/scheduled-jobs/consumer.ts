/**
 * Scheduled Jobs consumer — the ONLY code that writes Postgres for scheduled jobs.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { scheduledJobs, jobExecutionHistory } from "./schema.js";
import { eq, and, ne, or, lt, isNull } from "drizzle-orm";

const log = pino({ name: "admin-scheduled-jobs-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "scheduled_job";
const RUN_NOW_DEBOUNCE_MS = 60_000;

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerScheduledJobConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; name: string; description: string;
    cronExpression: string; timezone: string; targetService: string;
    targetCommand: string; payload: Record<string, unknown>; enabled: boolean;
  }>(COMMANDS.scheduledJobCreate, async (msg) => {
    try {
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
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.scheduledJobCreate }, "Consumer processing failed");
    }
  });

  queue.subscribe<{
    jobId: string; tenantId: string; name?: string; description?: string;
    cronExpression?: string; timezone?: string; targetService?: string;
    targetCommand?: string; payload?: Record<string, unknown>; enabled?: boolean;
  }>(COMMANDS.scheduledJobUpdate, async (msg) => {
    try {
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
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.scheduledJobUpdate }, "Consumer processing failed");
    }
  });

  type ActionPayload = { jobId: string; tenantId: string; reason?: string };

  // Delete / run-now / pause / resume are conditional transitions: each one
  // acts only if the job still exists (and, for run-now, is not already
  // running), so a stale or duplicated command is a no-op with no audit row
  // instead of an orphan history row or a double fire.
  queue.subscribe<ActionPayload>(COMMANDS.scheduledJobDelete, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const removed = await (tx as any).delete(scheduledJobs)
          .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)))
          .returning({ id: scheduledJobs.id });
        if (removed.length === 0) return;
        await emit(tx, msg, "admin.scheduled_job.deleted", p, "delete", p.jobId, p.reason);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.scheduledJobDelete }, "Consumer processing failed");
    }
  });

  queue.subscribe<ActionPayload>(COMMANDS.scheduledJobRunNow, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const started = await (tx as any).update(scheduledJobs)
          .set({ lastRunAt: new Date(), lastRunStatus: "running", updatedBy: msg.actorId, updatedAt: new Date() })
          .where(and(
            eq(scheduledJobs.id, p.jobId),
            eq(scheduledJobs.tenantId, p.tenantId),
            // Debounce a double click / redelivered request: a job that started
            // running within the last RUN_NOW_DEBOUNCE_MS is not fired again.
            or(ne(scheduledJobs.lastRunStatus, "running"), isNull(scheduledJobs.lastRunAt), lt(scheduledJobs.lastRunAt, new Date(Date.now() - RUN_NOW_DEBOUNCE_MS))),
          ))
          .returning({ id: scheduledJobs.id });
        if (started.length === 0) return;
        const executionId = crypto.randomUUID();
        await (tx as any).insert(jobExecutionHistory).values({
          id: executionId,
          tenantId: p.tenantId,
          jobId: p.jobId,
          startedAt: new Date(),
          status: "running",
        });
        await emit(tx, msg, "admin.scheduled_job.run_triggered", { ...p, executionId }, "run_now", p.jobId, p.reason);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.scheduledJobRunNow }, "Consumer processing failed");
    }
  });

  for (const [command, enabled, event, action] of [
    [COMMANDS.scheduledJobPause, false, "admin.scheduled_job.paused", "pause"],
    [COMMANDS.scheduledJobResume, true, "admin.scheduled_job.resumed", "resume"],
  ] as const) {
    queue.subscribe<ActionPayload>(command, async (msg) => {
      try {
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          const p = msg.payload;
          const changed = await (tx as any).update(scheduledJobs)
            .set({ enabled, updatedBy: msg.actorId, updatedAt: new Date() })
            .where(and(eq(scheduledJobs.id, p.jobId), eq(scheduledJobs.tenantId, p.tenantId)))
            .returning({ id: scheduledJobs.id });
          if (changed.length === 0) return;
          await emit(tx, msg, event, p, action, p.jobId, p.reason);
        });
        await cache.invalidate(listKey(msg.payload.tenantId));
      } catch (err) {
        log.error({ err, messageId: msg.messageId, type: command }, "Consumer processing failed");
      }
    });
  }
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
  reason?: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success", ...(reason ? { reason } : {}) },
  });
}
