import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCES } from "../../topics.js";
import * as repo from "./repo.js";
import type { GeofenceView } from "./schema.js";
import { haversineDistance, pointInPolygon } from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCES.geofence, id);
}

export function registerGeofenceConsumers(queue: Queue): void {
  queue.subscribe<GeofenceView>(COMMANDS.geofenceCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        type: p.type as "office" | "site" | "zone",
        centerLat: p.centerLat,
        centerLng: p.centerLng,
        radiusMeters: p.radiusMeters,
        polygon: p.polygon,
        active: p.active,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.geofenceCreated, { geofenceId: p.id, name: p.name }, "create", p.id);
    });
    await cache.put(keyFor(msg.tenantId, msg.payload.id), msg.payload);
    await cache.invalidateResource(msg.tenantId, RESOURCES.geofence);
  });

  queue.subscribe<{ id: string } & Record<string, unknown>>(COMMANDS.geofenceUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, ...data } = msg.payload;
      await repo.update(tx, id as string, msg.tenantId, { ...data, updatedBy: msg.actorId });
      await emit(tx, msg, EVENTS.geofenceUpdated, { geofenceId: id }, "update", id as string);
    });
    await cache.invalidate(keyFor(msg.tenantId, msg.payload.id as string));
    await cache.invalidateResource(msg.tenantId, RESOURCES.geofence);
  });

  queue.subscribe<{ geofenceId: string; lat: number; lng: number }>(COMMANDS.geofenceCheck, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const geofence = await repo.findById(msg.payload.geofenceId, msg.tenantId);
      if (!geofence) return;

      const distance = haversineDistance(msg.payload.lat, msg.payload.lng, geofence.centerLat, geofence.centerLng);
      let inside = distance <= geofence.radiusMeters;

      // If polygon is defined, use polygon check instead
      if (geofence.polygon && geofence.polygon.length >= 3) {
        inside = pointInPolygon(msg.payload.lat, msg.payload.lng, geofence.polygon);
      }

      await emit(tx, msg, EVENTS.geofenceChecked, {
        geofenceId: msg.payload.geofenceId,
        lat: msg.payload.lat,
        lng: msg.payload.lng,
        inside,
        distanceMeters: Math.round(distance),
      }, "check", msg.payload.geofenceId);
    });
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
    payload: { service: "location", action, resourceType: "geofence", resourceId, outcome: "success" },
  });
}
