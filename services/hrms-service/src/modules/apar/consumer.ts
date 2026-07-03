import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "apar-consumer" });
const AUDIT = "audit.event.record";

export function registerAparConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.aparCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      appraisalPeriod: string;
      reportingOfficerId: string;
      reviewingOfficerId: string;
      acceptingAuthorityId: string;
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
          resourceType: "apar",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "apar", p.employeeId));
    log.info({ messageId: msg.messageId }, "apar create processed");
  });

  queue.subscribe(COMMANDS.aparSubmit, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      selfAppraisal: string;
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
          action: "submit",
          resourceType: "apar",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "apar", p.id));
    log.info({ messageId: msg.messageId }, "apar self-appraisal submit processed");
  });

  queue.subscribe(COMMANDS.aparReview, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      stage: string;
      remarks: string;
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
          action: "review",
          resourceType: "apar",
          resourceId: p.id,
          stage: p.stage,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "apar", p.id));
    log.info({ messageId: msg.messageId }, "apar review processed");
  });

  queue.subscribe(COMMANDS.aparAccept, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      remarks: string;
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
          action: "accept",
          resourceType: "apar",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "apar", p.id));
    log.info({ messageId: msg.messageId }, "apar accept processed");
  });

  log.info("apar consumers registered");
}
