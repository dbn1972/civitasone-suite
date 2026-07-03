import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "holidays-consumer" });
const AUDIT = "audit.event.record";

export function registerHolidayConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.holidayCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      date: string;
      type: string;
      applicableTo: string;
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
          action: "create",
          resourceType: "holiday",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    const year = p.date.slice(0, 4);
    await cache.invalidate(cache.makeKey(msg.tenantId, "holidays", year));
    log.info({ messageId: msg.messageId }, "holiday create processed");
  });

  queue.subscribe(COMMANDS.holidayDelete, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
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
          action: "delete",
          resourceType: "holiday",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "holidays", "list"));
    log.info({ messageId: msg.messageId }, "holiday delete processed");
  });

  log.info("holiday consumers registered");
}
