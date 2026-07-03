import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "pension-consumer" });
const AUDIT = "audit.event.record";

export function registerPensionConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.pensionInitiate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      retirementDate: string;
      pensionScheme: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Create pension case record with status 'initiated'
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "initiate",
          resourceType: "pension",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pension", p.employeeId));
    log.info({ messageId: msg.messageId }, "pension initiation processed");
  });

  queue.subscribe(COMMANDS.pensionApprove, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      pensionId: string;
      employeeId: string;
      approvedBy: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update pension case status to approved
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "approve",
          resourceType: "pension",
          resourceId: p.pensionId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pension", p.employeeId));
    log.info({ messageId: msg.messageId }, "pension approval processed");
  });

  queue.subscribe(COMMANDS.pensionCalculate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      retirementDate: string;
      daRatePct: number;
      commutePct: number;
      elBalanceDays: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Run pension engine computation and persist the record
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "calculate",
          resourceType: "pension",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "pension", p.employeeId));
    log.info({ messageId: msg.messageId }, "pension calculation processed");
  });

  log.info("pension consumers registered");
}
