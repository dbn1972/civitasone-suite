import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { LocationView } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerLocationConsumers(queue: Queue): void {
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

  queue.subscribe<{ id: string; tenantId: string; reason: string | null }>(
    COMMANDS.archiveLocation,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        const updated = await repo.setStatus(tx, msg.tenantId, p.id, "archived", msg.actorId);
        // Missing row: record the failed outcome in the audit trail rather than
        // silently swallowing — the API already returned 202.
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: "location",
            action: "archive",
            resourceType: "location",
            resourceId: p.id,
            outcome: updated ? "success" : "not_found",
            ...(p.reason ? { reason: p.reason } : {}),
          },
        });
      });
      await cache.invalidate(keyFor(msg.tenantId, msg.payload.id));
      await cache.invalidateResource(msg.tenantId, RESOURCE);
    },
  );
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
