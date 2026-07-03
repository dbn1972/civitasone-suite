import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "claims-consumer" });
const AUDIT = "audit.event.record";

export function registerClaimsConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.claimCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      claimType: "ltc" | "cea";
      amountMinor: number;
      details: Record<string, unknown>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Insert LTC or CEA claim with status 'submitted'
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "create",
          resourceType: "claim",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "claims", p.employeeId));
    log.info({ messageId: msg.messageId }, "claim created processed");
  });

  queue.subscribe(COMMANDS.claimApprove, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      claimId: string;
      claimType: "ltc" | "cea";
      approvedAmountMinor: number;
      approverRemarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update claim status to approved, set approved amount (cap enforcement)
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "approve",
          resourceType: "claim",
          resourceId: p.claimId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "claim", p.claimId));
    log.info({ messageId: msg.messageId }, "claim approval processed");
  });

  queue.subscribe(COMMANDS.claimReject, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      claimId: string;
      claimType: "ltc" | "cea";
      approverRemarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // TODO: Update claim status to rejected
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "reject",
          resourceType: "claim",
          resourceId: p.claimId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "claim", p.claimId));
    log.info({ messageId: msg.messageId }, "claim rejection processed");
  });

  log.info("claims consumers registered");
}
