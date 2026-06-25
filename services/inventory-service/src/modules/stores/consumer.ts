import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, INTEGRATION, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { createStorePayload } from "./validators.js";

export function registerStoreConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.storeCreate, async (msg) => {
    const p = createStorePayload.parse(msg.payload);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertStore(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, code: p.code,
        location: p.location ?? null, isActive: true,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: INTEGRATION.audit, eventType: INTEGRATION.audit,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "inventory", action: "create", resourceType: "store", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.store);
  });
}
