import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { FileView } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

async function emit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string) {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "document", action, resourceType: "file", resourceId, outcome: "success" },
  });
}

export function registerFilesConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<FileView>(COMMANDS.fileUpload, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        folderId: p.folderId,
        name: p.name,
        mimeType: p.mimeType,
        sizeBytes: p.sizeBytes,
        storageKey: p.storageKey,
        tags: p.tags,
        status: "active",
        version: 1,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await emit(tx, msg, EVENTS.fileUploaded, { fileId: p.id, name: p.name }, "upload", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ fileId: string }>(COMMANDS.fileDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.softDelete(tx, msg.tenantId, msg.payload.fileId, msg.actorId);
      await emit(tx, msg, EVENTS.fileDeleted, { fileId: msg.payload.fileId }, "delete", msg.payload.fileId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ fileId: string; folderId: string | null }>(COMMANDS.fileMove, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateFolder(tx, msg.tenantId, msg.payload.fileId, msg.payload.folderId, msg.actorId);
      await emit(tx, msg, EVENTS.fileMoved, { fileId: msg.payload.fileId, folderId: msg.payload.folderId }, "move", msg.payload.fileId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ fileId: string; tags: string[] }>(COMMANDS.fileTag, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateTags(tx, msg.tenantId, msg.payload.fileId, msg.payload.tags, msg.actorId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}
