import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "reservation-consumer" });
const AUDIT = "audit.event.record";

export function registerReservationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.rosterCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      cadre: string;
      rosterKind: string;
      rosterSize: number;
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
          resourceType: "roster",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "roster", "list"));
    log.info({ messageId: msg.messageId }, "roster create processed");
  });

  queue.subscribe(COMMANDS.rosterGeneratePoints, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      rosterId: string;
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
          action: "generate_points",
          resourceType: "roster",
          resourceId: p.rosterId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "roster_points", p.rosterId));
    log.info({ messageId: msg.messageId }, "roster generate points processed");
  });

  queue.subscribe(COMMANDS.sanctionedPostCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      cadre: string;
      sanctionedStrength: number;
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
          resourceType: "sanctioned_post",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanctioned_posts", "list"));
    log.info({ messageId: msg.messageId }, "sanctioned post create processed");
  });

  log.info("reservation consumers registered");
}
