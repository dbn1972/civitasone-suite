import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
/** A row that reached one of these is final: a late/stale sync must not move it. */
const FINAL = ["filed", "quarantined", "rejected"];

type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };

async function audit(tx: any, msg: Msg, action: string, id: string, newValue?: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "legal", action, resourceType: "affidavit", resourceId: id, outcome: "success", ...(newValue ? { newValue } : {}) },
  });
}

export function registerAttachmentConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.attachmentRegister, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseId: string; fileName: string; mimeType: string; sizeBytes: number;
      docBatchId: string; docFileId: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, kind: "affidavit", fileName: p.fileName,
        mimeType: p.mimeType, sizeBytes: p.sizeBytes, docBatchId: p.docBatchId, docFileId: p.docFileId,
        status: "awaiting_upload", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", p.id, { caseId: p.caseId, fileName: p.fileName });
    });
  });

  queue.subscribe(COMMANDS.attachmentUploaded, async (msg) => {
    const p = msg.payload as { id: string; caseId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findOneTx(tx, msg.tenantId, p.id);
      if (!row || row.status !== "awaiting_upload") return;
      await repo.setStatus(tx, msg.tenantId, p.id, "processing", msg.actorId);
      await audit(tx, msg, "upload_complete", p.id, { caseId: p.caseId });
    });
  });

  queue.subscribe(COMMANDS.attachmentSync, async (msg) => {
    const p = msg.payload as { id: string; caseId: string; status: string; documentId: string | null };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findOneTx(tx, msg.tenantId, p.id);
      if (!row || row.status === p.status || FINAL.includes(row.status)) return;
      await repo.setStatus(tx, msg.tenantId, p.id, p.status, msg.actorId, p.status === "filed" ? p.documentId : null);
      await audit(tx, msg, "status_change", p.id, { caseId: p.caseId, from: row.status, to: p.status });
    });
  });

  queue.subscribe(COMMANDS.attachmentOpen, async (msg) => {
    const p = msg.payload as { id: string; caseId: string; documentId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await audit(tx, msg, "open", p.id, { caseId: p.caseId, documentId: p.documentId });
    });
  });
}
