import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { AddReferenceBody } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

type AddPayload = AddReferenceBody & { id: string; tenantId: string };

function audit(msg: { tenantId: string; actorId: string; correlationId: string }, action: string, id: string, meta: Record<string, unknown> = {}) {
  return {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType: "reference", resourceId: id, outcome: "success" as const, metadata: meta },
  };
}

export function registerReferencingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.referenceAdd, async (msg) => {
    const p = msg.payload as AddPayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReference(tx, {
        id: p.id, tenantId: p.tenantId, fileId: p.fileId,
        ...(p.noteId ? { noteId: p.noteId } : {}),
        refType: p.refType, refValue: p.refValue,
        ...(p.label ? { label: p.label } : {}),
        ...(p.targetFileId ? { targetFileId: p.targetFileId } : {}),
        ...(p.pageFrom ? { pageFrom: p.pageFrom } : {}),
        ...(p.pageTo ? { pageTo: p.pageTo } : {}),
        createdBy: msg.actorId,
      });
      await enqueue(tx, audit(msg, "reference.add", p.id, { refType: p.refType, fileId: p.fileId }));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "references", p.fileId));
  });

  queue.subscribe(COMMANDS.referenceRemove, async (msg) => {
    const p = msg.payload as { referenceId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findReferenceById(p.referenceId, p.tenantId);
      if (!existing) return;
      await repo.deleteReference(tx, p.referenceId, p.tenantId);
      await enqueue(tx, audit(msg, "reference.remove", p.referenceId, { fileId: existing.fileId }));
    });
    await cache.invalidate(cache.makeKey(p.tenantId, "references", p.referenceId));
  });
}
