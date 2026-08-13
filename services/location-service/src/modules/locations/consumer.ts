import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { LocationView } from "./schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerLocationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  queue.subscribe<LocationView>(COMMANDS.createLocation, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        addressLine: p.addressLine,
        city: p.city,
        postalCode: p.postalCode,
        parentId: p.parentId,
        type: p.type,
        lgdCode: p.lgdCode,
        latitude: p.latitude,
        longitude: p.longitude,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.locationCreated, { locationId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  queue.subscribe<{ id: string } & Record<string, unknown>>(COMMANDS.locationUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, ...fields } = msg.payload as { id: string } & Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      const allowed = ["name", "addressLine", "city", "postalCode", "type", "lgdCode", "parentId", "latitude", "longitude", "status"];
      for (const k of allowed) {
        if (k in fields) patch[k] = fields[k];
      }
      await repo.updateById(tx as Parameters<typeof repo.updateById>[0], id, msg.tenantId, { ...patch, updatedBy: msg.actorId } as Parameters<typeof repo.updateById>[3]);
      await cache.invalidateResource(msg.tenantId, RESOURCE);
      await emit(tx, msg, EVENTS.locationUpdated, { locationId: id }, "update", id);
    });
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
    payload: { service: "location", action, resourceType: "location", resourceId, outcome: "success" },
  });
}
