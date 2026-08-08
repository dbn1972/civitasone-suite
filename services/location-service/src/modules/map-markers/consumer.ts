import type { Queue } from "@civitasone/queue";
import { withTenantConsumer } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { geoPoints } from "./schema.js";

/** Command topic other services publish to register a monitoring geo-point. */
export const GEO_POINT_REGISTER = "location.geo_point.register";

const AUDIT_TOPIC = "audit.event.record";

type Payload = { domain: string; refId: string; lat: number; lng: number; label?: string | null; status?: string | null };

/**
 * SVC-119: extension point — any service can publish `location.geo_point.register`
 * to place a point on the monitoring map. Idempotent upsert in a tenant-GUC tx.
 */
export function registerGeoPointConsumers(queue: Queue): void {
  queue.subscribe<Payload>(GEO_POINT_REGISTER, withTenantConsumer(async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      await tx.insert(geoPoints).values({
        tenantId: msg.tenantId, domain: p.domain, refId: p.refId, lat: String(p.lat), lng: String(p.lng),
        label: p.label ?? null, status: p.status ?? "active", createdBy: msg.actorId,
      }).onConflictDoUpdate({
        target: [geoPoints.tenantId, geoPoints.domain, geoPoints.refId],
        set: { lat: String(p.lat), lng: String(p.lng), label: p.label ?? null, status: p.status ?? "active", updatedAt: new Date() },
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "location", action: "register_geo_point", resourceType: "geo_point", resourceId: p.refId, outcome: "success" },
      });
    });
  }));
}
