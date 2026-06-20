import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerPaymentsConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; invoiceId: string; amountMinor: number; gateway: string }>(COMMANDS.paymentRecord, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPayment(tx, {
        id: msg.payload.id, tenantId: msg.payload.tenantId, invoiceId: msg.payload.invoiceId,
        amountMinor: BigInt(msg.payload.amountMinor), status: "completed",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const txnId = randomUUID();
      await repo.insertGatewayTxn(tx, {
        id: txnId, tenantId: msg.payload.tenantId, paymentId: msg.payload.id,
        gateway: msg.payload.gateway, status: "initiated",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.payload.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "billing", action: "payment_record", resourceType: "payment", resourceId: msg.payload.id, outcome: "success" },
      });
    });
  });
}
