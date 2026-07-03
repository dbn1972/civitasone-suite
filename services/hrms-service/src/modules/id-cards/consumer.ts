import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "id-cards-consumer" });
const AUDIT = "audit.event.record";

export function registerIdCardConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.idCardIssue, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId?: string;
      holderName: string;
      cardType: string;
      validUntil: string;
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
          action: "issue",
          resourceType: "id_card",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    if (p.employeeId) {
      await cache.invalidate(cache.makeKey(msg.tenantId, "id_card", p.employeeId));
    }
    log.info({ messageId: msg.messageId }, "id card issue processed");
  });

  queue.subscribe(COMMANDS.idCardSuspend, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      reason?: string;
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
          action: "suspend",
          resourceType: "id_card",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "id_card", p.id));
    log.info({ messageId: msg.messageId }, "id card suspend processed");
  });

  queue.subscribe(COMMANDS.idCardRevoke, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      reason?: string;
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
          action: "revoke",
          resourceType: "id_card",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "id_card", p.id));
    log.info({ messageId: msg.messageId }, "id card revoke processed");
  });

  queue.subscribe(COMMANDS.idCardReactivate, async (msg) => {
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
          action: "reactivate",
          resourceType: "id_card",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "id_card", p.id));
    log.info({ messageId: msg.messageId }, "id card reactivate processed");
  });

  log.info("id-card consumers registered");
}
