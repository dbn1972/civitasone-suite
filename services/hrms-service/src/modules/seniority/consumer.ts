import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "seniority-consumer" });
const AUDIT = "audit.event.record";

export function registerSeniorityConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.seniorityGenerate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      departmentId?: string;
      designationId?: string;
      asOf: string;
      requestedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Generate seniority list snapshot, persist ranked entries
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "generate",
          resourceType: "seniority_list",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "seniority", "list"));
    log.info({ messageId: msg.messageId }, "seniority list generation processed");
  });

  queue.subscribe(COMMANDS.seniorityApprove, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      seniorityListId: string;
      approvedBy: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Mark seniority list as approved/published
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "approve",
          resourceType: "seniority_list",
          resourceId: p.seniorityListId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "seniority", p.seniorityListId));
    log.info({ messageId: msg.messageId }, "seniority list approval processed");
  });

  log.info("seniority consumers registered");
}
