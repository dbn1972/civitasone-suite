import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "hrms.rti.consumer" });
const AUDIT = "audit.event.record";

export function registerRtiConsumers(queue: Queue): void {
  queue.subscribe("hrms.rti.file", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      referenceNo: string; applicantName: string;
      subject: string; requestText: string; receivedDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.rti.filed",
        eventType: "hrms.rti.filed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, referenceNo: p.referenceNo, applicantName: p.applicantName },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "rti_file", resourceType: "rti_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:rti:*`);
    log.info({ id: msg.messageId, rtiId: p.id }, "Processed rti.file");
  });

  queue.subscribe("hrms.rti.assign", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; pioId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.rti.assigned",
        eventType: "hrms.rti.assigned",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, pioId: p.pioId },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "rti_assign", resourceType: "rti_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:rti:*`);
    log.info({ id: msg.messageId, rtiId: p.id }, "Processed rti.assign");
  });

  queue.subscribe("hrms.rti.respond", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; responseText: string; respondedDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.rti.responded",
        eventType: "hrms.rti.responded",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, respondedDate: p.respondedDate },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "rti_respond", resourceType: "rti_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:rti:*`);
    log.info({ id: msg.messageId, rtiId: p.id }, "Processed rti.respond");
  });

  queue.subscribe("hrms.rti.appeal", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; appealText: string; appealDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.rti.appealed",
        eventType: "hrms.rti.appealed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, appealDate: p.appealDate },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "rti_appeal", resourceType: "rti_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:rti:*`);
    log.info({ id: msg.messageId, rtiId: p.id }, "Processed rti.appeal");
  });

  queue.subscribe("hrms.rti.close", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; closedDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: "hrms.rti.closed",
        eventType: "hrms.rti.closed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, closedDate: p.closedDate },
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "rti_close", resourceType: "rti_request", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(`hrms:${msg.tenantId}:rti:*`);
    log.info({ id: msg.messageId, rtiId: p.id }, "Processed rti.close");
  });
}
