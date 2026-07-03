import { pino } from "pino";
import { createHash } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const log = pino({ name: "finance.pfms.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerPfmsConsumers(queue: Queue): void {
  queue.subscribe("finance.pfms.batch_sign", async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; certificateRef: string; signaturePayload: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const batch = await repo.findPfmsById(p.id, p.tenantId);
      if (!batch) throw new Error(`PFMS batch ${p.id} not found`);
      if (batch.submissionStatus === "signed") return; // idempotent

      const hash = createHash("sha256").update(p.signaturePayload).digest("hex");
      const sigRef = `DSC:${p.certificateRef.slice(0, 32)}:${hash.slice(0, 16)}`;
      await repo.updatePfmsBatch(tx, p.id, {
        signedAt: new Date(),
        signedBy: msg.actorId,
        signatureRef: sigRef,
        bankFileHash: hash,
        submissionStatus: "signed",
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.pfms.batch_signed", eventType: "finance.pfms.batch_signed",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { batchId: p.id, signatureRef: sigRef },
      });
      await audit(tx, msg, "sign", "pfms_batch", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:pfms:*`);
    log.info({ id: msg.messageId }, "Processed pfms.batch_sign");
  });

  queue.subscribe("finance.pfms.batch_submit", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const batch = await repo.findPfmsById(p.id, p.tenantId);
      if (!batch) throw new Error(`PFMS batch ${p.id} not found`);
      if (batch.submissionStatus === "submitted") return; // idempotent
      if (batch.submissionStatus !== "signed") {
        throw new Error(`PFMS batch ${p.id} must be signed before submission`);
      }
      await repo.updatePfmsBatch(tx, p.id, {
        submissionStatus: "submitted",
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.pfms.batch_submitted", eventType: "finance.pfms.batch_submitted",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { batchId: p.id },
      });
      await audit(tx, msg, "submit", "pfms_batch", p.id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:pfms:*`);
    log.info({ id: msg.messageId }, "Processed pfms.batch_submit");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
