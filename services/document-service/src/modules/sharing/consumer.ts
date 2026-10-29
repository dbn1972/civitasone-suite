import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * FQ12-SEC (UAT #123/#124): granting or revoking access to a document is an
 * access-control change and must leave an audit trail. Emitted through the
 * outbox in the SAME transaction as the write, exactly like the files /
 * folders / workflow consumers (service "document", topic audit.event.record).
 * Actor and tenant ride on the envelope; the payload names the document, the
 * share target and the permission (ids only, no PII).
 */
async function auditShare(
  tx: unknown,
  msg: CommandEnvelope,
  action: "share_create" | "share_revoke",
  shareId: string,
  details: { fileId: string | null; sharedWith: string | null; permission: string | null },
  outcome: "success" | "failure" = "success",
): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: {
      service: "document", action, resourceType: "file_share", resourceId: shareId, outcome,
      details: { documentId: details.fileId, sharedWith: details.sharedWith, permission: details.permission },
    },
  });
}

export function registerSharingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<{ id: string; fileId: string; sharedWith: string; permission: string }>(COMMANDS.shareCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, { id: p.id, tenantId: msg.tenantId, fileId: p.fileId, sharedWith: p.sharedWith, permission: p.permission, createdBy: msg.actorId });
      await auditShare(tx, msg, "share_create", p.id, { fileId: p.fileId, sharedWith: p.sharedWith, permission: p.permission });
    });
  });

  queue.subscribe<{ shareId: string }>(COMMANDS.shareRevoke, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const revoked = await repo.revoke(tx, msg.tenantId, msg.payload.shareId, msg.actorId);
      // A revoke that matched no share is still recorded (as a failure) so an
      // attempted access change is never silent.
      await auditShare(
        tx, msg, "share_revoke", msg.payload.shareId,
        { fileId: revoked?.fileId ?? null, sharedWith: revoked?.sharedWith ?? null, permission: revoked?.permission ?? null },
        revoked ? "success" : "failure",
      );
    });
  });
}
