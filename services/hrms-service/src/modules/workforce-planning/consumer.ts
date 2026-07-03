import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "workforce-planning-consumer" });
const AUDIT = "audit.event.record";

export function registerWorkforcePlanningConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.workforcePlanRefresh, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      scope?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "refresh",
          resourceType: "workforce_plan",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "workforce", "headcount"));
    await cache.invalidate(cache.makeKey(msg.tenantId, "workforce", "vacancy_forecast"));
    log.info({ messageId: msg.messageId }, "workforce plan refresh processed");
  });

  log.info("workforce-planning consumers registered");
}
