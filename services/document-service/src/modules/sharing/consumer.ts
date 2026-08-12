import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

export function registerSharingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<{ id: string; fileId: string; sharedWith: string; permission: string }>(COMMANDS.shareCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, { id: msg.payload.id, tenantId: msg.tenantId, fileId: msg.payload.fileId, sharedWith: msg.payload.sharedWith, permission: msg.payload.permission, createdBy: msg.actorId });
    });
  });

  queue.subscribe<{ shareId: string }>(COMMANDS.shareRevoke, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.revoke(tx, msg.tenantId, msg.payload.shareId, msg.actorId);
    });
  });
}
