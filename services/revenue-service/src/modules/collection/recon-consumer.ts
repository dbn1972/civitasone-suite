import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS, SERVICE } from "../../topics.js";
import { receipts } from "./schema.js";
import { eq, and } from "drizzle-orm";

const logger = pino({ name: "revenue-recon-consumer" });

export function registerReconConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.bankStatementReconciled, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const { reference, reconLineId } = msg.payload as {
        reference: string;
        reconLineId: string;
      };

      // Find receipt by reference for this tenant
      const rows = await tx
        .select()
        .from(receipts)
        .where(and(eq(receipts.tenantId, msg.tenantId), eq(receipts.reference, reference)))
        .limit(1);

      const receipt = rows[0];

      if (!receipt) {
        logger.warn(`No receipt found for reconciliation reference ${reference}`);
        return;
      }

      // Mark receipt as reconciled
      await tx
        .update(receipts)
        .set({ reconciled: true, reconLineId })
        .where(eq(receipts.id, receipt.id));

      // Enqueue audit event
      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE,
          action: "reconcile",
          resourceType: "receipt",
          resourceId: receipt.id,
          outcome: "success",
        },
      });
    });
  });
}
