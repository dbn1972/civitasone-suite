import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { CategoryView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "category";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerCategoriesConsumers(queue: Queue): void {
  queue.subscribe<CategoryView>(COMMANDS.categoryCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        parentId: p.parentId,
        name: p.name,
        slug: p.slug,
        description: p.description,
        icon: p.icon,
        sortOrder: p.sortOrder,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.categoryCreated, { categoryId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.categoryUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { id: string } & Record<string, unknown>;
      await repo.update(tx, p.id, { ...p, updatedBy: msg.actorId, updatedAt: new Date() } as never);
      await emit(tx, msg, EVENTS.categoryUpdated, { categoryId: p.id }, "update", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, (msg.payload as { id: string }).id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.categoryDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { id: string };
      await repo.remove(tx, p.id);
      await emit(tx, msg, EVENTS.categoryDeleted, { categoryId: p.id }, "delete", p.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, (msg.payload as { id: string }).id));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe(COMMANDS.categoryReorder, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload as { items: { id: string; sortOrder: number }[] };
      for (const item of p.items) {
        await repo.update(tx, item.id, { sortOrder: item.sortOrder, updatedBy: msg.actorId } as never);
      }
      await emit(tx, msg, EVENTS.categoryReordered, { count: p.items.length }, "reorder", msg.messageId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "knowledge", action, resourceType: "category", resourceId, outcome: "success" },
  });
}
