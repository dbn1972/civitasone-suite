import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "lifecycle-consumer" });
const AUDIT = "audit.event.record";

export function registerLifecycleConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.lifecycleConfirm, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      confirmationDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status to confirmed, set confirmationDate
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "confirm",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee confirmation processed");
  });

  queue.subscribe(COMMANDS.lifecycleSeparate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      separationType: string;
      effectiveDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status to separated, record separation details
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "separate",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee separation processed");
  });

  queue.subscribe(COMMANDS.lifecycleReinstate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      reinstatementDate: string;
      orderRef?: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update employee status back to active, clear separation fields
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "reinstate",
          resourceType: "employee",
          resourceId: p.employeeId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
    log.info({ messageId: msg.messageId }, "employee reinstatement processed");
  });

  log.info("lifecycle consumers registered");
}
