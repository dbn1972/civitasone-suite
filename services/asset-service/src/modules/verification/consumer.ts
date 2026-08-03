// @ts-nocheck — F3 residual verification consumer
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "asset-verification-consumer" });
const AUDIT = "audit.event.record";

function audit(
  actorId: string, tenantId: string, correlationId: string,
  action: string, resourceType: string, resourceId: string,
) {
  return {
    topic: AUDIT, eventType: AUDIT, tenantId, actorId, correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  };
}

export function registerVerificationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.verificationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; verificationDate: string; notes?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertVerification(tx, {
          id: p.id, tenantId: p.tenantId, verificationDate: p.verificationDate,
          verifiedBy: msg.actorId, status: "draft", notes: p.notes ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_create", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationCreate failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationItemAdd, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; verificationId: string; assetId: string;
      condition: string; foundAtLocation?: boolean; remarks?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertVerificationItem(tx, {
          id: p.id, verificationId: p.verificationId, tenantId: p.tenantId, assetId: p.assetId,
          condition: p.condition, foundAtLocation: p.foundAtLocation ?? true,
          remarks: p.remarks ?? null,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_item_add", "verification_item", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationItemAdd failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationSubmit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateVerification(tx, p.id, p.tenantId, { status: "submitted" });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_submit", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationSubmit failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.verificationApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateVerification(tx, p.id, p.tenantId, {
          status: "approved", approvedBy: msg.actorId, approvedAt: new Date(),
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "verification_approve", "verification", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "verificationApprove failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.writeoffRequest, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; assetId: string; remarks?: string | null;
    };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertWriteoffRequest(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId, requestedBy: msg.actorId,
          status: "pending", committeeRemarks: p.remarks ?? null,
        });
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "writeoff_request", "writeoff", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "writeoffRequest failed");
      throw err;
    }
  });

  queue.subscribe(COMMANDS.writeoffApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      // SoD is enforced at the route boundary before publish.
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.approveWriteoff(tx, p.id, p.tenantId, msg.actorId);
        await enqueue(tx, audit(msg.actorId, msg.tenantId, msg.correlationId, "writeoff_approve", "writeoff", p.id));
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "writeoffApprove failed");
      throw err;
    }
  });
}
