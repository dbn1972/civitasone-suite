import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "gpf-consumer" });
const AUDIT = "audit.event.record";

export function registerGpfConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.gpfAdvance, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      accountId: string;
      amountMinor: number;
      narrative?: string;
      effectiveDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Debit GPF balance, insert ledger entry (type=advance)
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "advance",
          resourceType: "gpf",
          resourceId: p.accountId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gpf", p.employeeId));
    log.info({ messageId: msg.messageId }, "gpf advance processed");
  });

  queue.subscribe(COMMANDS.gpfWithdrawal, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      accountId: string;
      amountMinor: number;
      narrative?: string;
      effectiveDate?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Debit GPF balance, insert ledger entry (type=withdrawal)
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "withdrawal",
          resourceType: "gpf",
          resourceId: p.accountId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gpf", p.employeeId));
    log.info({ messageId: msg.messageId }, "gpf withdrawal processed");
  });

  queue.subscribe(COMMANDS.gpfFinalSettlement, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      accountId: string;
      settlementAmountMinor: number;
      reason: string;
      effectiveDate: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Close GPF account, debit full balance as final settlement
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "final_settlement",
          resourceType: "gpf",
          resourceId: p.accountId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "gpf", p.employeeId));
    log.info({ messageId: msg.messageId }, "gpf final settlement processed");
  });

  log.info("gpf consumers registered");
}
