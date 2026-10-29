import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";
type TxParam = Parameters<typeof enqueue>[0];
type Msg = { tenantId: string; actorId: string; correlationId: string };

async function audit(tx: TxParam, msg: Msg, action: string, resourceId: string, outcome: "success" | "denied", details?: Record<string, unknown>): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "document", action, resourceType: "folder", resourceId, outcome, ...(details ? { details } : {}) } });
}

export function registerFoldersConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<{ id: string; tenantId: string; name: string; parentId: string | null; path: string }>(COMMANDS.folderCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      // #112: the name path is computed here under the tree lock (the command's `path` is ignored).
      const outcome = await repo.create(tx, { id: p.id, tenantId: p.tenantId, name: p.name, parentId: p.parentId, createdBy: msg.actorId, updatedBy: msg.actorId });
      if (outcome !== "ok") {
        await audit(tx as TxParam, msg, "create", p.id, "denied", { parentId: p.parentId, reason: outcome });
        return;
      }
      await enqueue(tx as never, { topic: EVENTS.folderCreated, eventType: EVENTS.folderCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { folderId: p.id } });
      await audit(tx as TxParam, msg, "create", p.id, "success");
    });
  });

  queue.subscribe<{ folderId: string; name: string }>(COMMANDS.folderRename, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const outcome = await repo.rename(tx, msg.tenantId, msg.payload.folderId, msg.payload.name, msg.actorId);
      if (outcome === "ok") await audit(tx as TxParam, msg, "rename", msg.payload.folderId, "success", { name: msg.payload.name });
      else if (outcome !== "not_found") await audit(tx as TxParam, msg, "rename", msg.payload.folderId, "denied", { name: msg.payload.name, reason: outcome });
    });
  });

  queue.subscribe<{ folderId: string; parentId: string | null }>(COMMANDS.folderMove, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const outcome = await repo.move(tx, msg.tenantId, msg.payload.folderId, msg.payload.parentId, msg.actorId);
      const details = { parentId: msg.payload.parentId };
      if (outcome === "ok") await audit(tx as TxParam, msg, "move", msg.payload.folderId, "success", details);
      else await audit(tx as TxParam, msg, "move", msg.payload.folderId, "denied", { ...details, reason: outcome });
    });
  });
}
