import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
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
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createCalendar failed"); throw err; }
  });
  queue.subscribe(COMMANDS.pauseTaskSla, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason?: string | null };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.pauseTask(p.tenantId, p.id, p.reason ?? null, msg.actorId);
        await enqueue(tx, { topic: EVENTS.taskSlaPaused, eventType: EVENTS.taskSlaPaused,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { taskId: p.id } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "pauseTaskSla failed"); throw err; }
  });
  queue.subscribe(COMMANDS.resumeTaskSla, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.resumeTask(p.tenantId, p.id);
        await enqueue(tx, { topic: EVENTS.taskSlaResumed, eventType: EVENTS.taskSlaResumed,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { taskId: p.id } });
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "resumeTaskSla failed"); throw err; }
  });
}
