import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerFoldersConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<{ id: string; tenantId: string; name: string; parentId: string | null; path: string }>(COMMANDS.folderCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, { id: p.id, tenantId: p.tenantId, name: p.name, parentId: p.parentId, path: p.path, createdBy: msg.actorId, updatedBy: msg.actorId });
      await enqueue(tx as never, { topic: EVENTS.folderCreated, eventType: EVENTS.folderCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { folderId: p.id } });
      await enqueue(tx as never, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action: "create", resourceType: "folder", resourceId: p.id, outcome: "success" } });
    });
  });

  queue.subscribe<{ folderId: string; name: string }>(COMMANDS.folderRename, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.rename(tx, msg.tenantId, msg.payload.folderId, msg.payload.name, msg.actorId);
    });
  });

  queue.subscribe<{ folderId: string; parentId: string | null }>(COMMANDS.folderMove, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.move(tx, msg.tenantId, msg.payload.folderId, msg.payload.parentId, msg.actorId);
    });
  });
}
