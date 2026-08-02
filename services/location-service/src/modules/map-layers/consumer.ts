import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCES } from "../../topics.js";
import * as repo from "./repo.js";
import type { MapLayerView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCES.mapLayer, id);
}

export function registerMapLayerConsumers(queue: Queue): void {
  queue.subscribe<MapLayerView>(COMMANDS.mapLayerCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        name: p.name,
        sourceType: p.sourceType,
        url: p.url,
        styleJson: p.styleJson,
        zIndex: p.zIndex,
        visible: p.visible,
        createdBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.mapLayerCreated, { mapLayerId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCES.mapLayer);
  });

  queue.subscribe<{ id: string } & Record<string, unknown>>(COMMANDS.mapLayerUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, ...data } = msg.payload;
      await repo.update(tx, id as string, msg.tenantId, { ...data, updatedBy: msg.actorId });
      await emit(tx, msg, EVENTS.mapLayerUpdated, { mapLayerId: id }, "update", id as string);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id as string));
    await cache.invalidateResource(msg.tenantId, RESOURCES.mapLayer);
  });

  queue.subscribe<{ id: string }>(COMMANDS.mapLayerDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const deleted = await repo.remove(tx, msg.payload.id, msg.tenantId);
      if (deleted === 0) return;
      await emit(tx, msg, EVENTS.mapLayerDeleted, { mapLayerId: msg.payload.id }, "delete", msg.payload.id);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
    await cache.invalidateResource(msg.tenantId, RESOURCES.mapLayer);
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
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
    payload: { service: "location", action, resourceType: "map_layer", resourceId, outcome: "success" },
  });
}
