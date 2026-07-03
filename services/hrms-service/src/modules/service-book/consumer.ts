import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "service-book-consumer" });
const AUDIT = "audit.event.record";

export function registerServiceBookConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.serviceBookAddEntry, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      entryType: string;
      effectiveDate: string;
      description: string;
      documentRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertServiceBookEntry(tx, {
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        entryType: p.entryType,
        effectiveDate: p.effectiveDate,
        description: p.description,
        documentRef: p.documentRef ?? null,
        recordedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "add_entry",
          resourceType: "service_book",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "service_book", p.employeeId));
    log.info({ messageId: msg.messageId }, "service book add entry processed");
  });

  queue.subscribe(COMMANDS.serviceBookVerify, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      entryId: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.attestEntry(p.tenantId, p.entryId, msg.actorId, p.remarks ?? null);
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "verify",
          resourceType: "service_book",
          resourceId: p.entryId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "service_book_entry", p.entryId));
    log.info({ messageId: msg.messageId }, "service book verify processed");
  });

  log.info("service-book consumers registered");
}
