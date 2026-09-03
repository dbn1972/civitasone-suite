import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const AUDIT_TOPIC = "audit.event.record";
import * as repo from "./repo.js";
const log = pino({ name: "workflow-sla-consumer" });
export function registerSlaConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createCalendar, async (msg) => {
    const p = msg.payload as Record<string, any>;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.createCalendar({
          tenantId: p.tenantId, code: p.code, name: p.name, timezone: p.timezone,
          workweek: p.workweek, holidays: p.holidays, workStartMinute: p.workStartMinute,
          workEndMinute: p.workEndMinute, createdBy: msg.actorId,
        });
        await enqueue(tx, { topic: EVENTS.calendarCreated, eventType: EVENTS.calendarCreated,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id, code: p.code } });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "create", resourceType: "calendar", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createCalendar failed"); throw err; }
  });
  queue.subscribe(COMMANDS.pauseTaskSla, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const paused = await repo.pauseTask(p.tenantId, p.id, p.reason ?? null, msg.actorId);
        // pauseTask returns null when a pause is already open (idempotent
        // no-op, e.g. a race with another pause request for the same task).
        // Emitting taskSlaPaused + an audit "success" record here regardless
        // was wrong: it published a duplicate pause event for a write that
        // never happened.
        if (!paused) {
          log.warn({ messageId: msg.messageId, taskId: p.id }, "pauseTaskSla no-op: already paused");
          return;
        }
        await enqueue(tx, { topic: EVENTS.taskSlaPaused, eventType: EVENTS.taskSlaPaused,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { taskId: p.id } });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "pause", resourceType: "task_sla", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "pauseTaskSla failed"); throw err; }
  });
  queue.subscribe(COMMANDS.resumeTaskSla, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const resumed = await repo.resumeTask(p.tenantId, p.id);
        // resumeTask returns null when there was no open pause to resume
        // (e.g. resume replayed, or resume raced ahead of pause). Same
        // false-success problem as pauseTaskSla above.
        if (!resumed) {
          log.warn({ messageId: msg.messageId, taskId: p.id }, "resumeTaskSla no-op: no open pause");
          return;
        }
        await enqueue(tx, { topic: EVENTS.taskSlaResumed, eventType: EVENTS.taskSlaResumed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { taskId: p.id } });
        await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "workflow-service", action: "resume", resourceType: "task_sla", resourceId: p.id, outcome: "success" } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "resumeTaskSla failed"); throw err; }
  });
}
