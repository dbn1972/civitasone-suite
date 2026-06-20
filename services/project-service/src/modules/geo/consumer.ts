import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerGeoConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.geoTag, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; lat: number; lon: number;
      locationName?: string; description?: string; taggedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertGeoTag(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        lat: String(p.lat), lon: String(p.lon),
        locationName: p.locationName ?? null, description: p.description ?? null,
        taggedBy: p.taggedBy, taggedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.geoTagged, eventType: EVENTS.geoTagged,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { geoTagId: p.id, projectId: p.projectId, lat: p.lat, lon: p.lon },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "project", action: "tag", resourceType: "geo_tag", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "geo", p.projectId));
  });

  queue.subscribe(COMMANDS.photoUpload, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; geoTagId?: string;
      s3Key: string; originalName: string; description?: string; uploadedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertSitePhoto(tx, {
        id: p.id, projectId: p.projectId, geoTagId: p.geoTagId ?? null,
        tenantId: p.tenantId, s3Key: p.s3Key, originalName: p.originalName,
        description: p.description ?? null, uploadedBy: p.uploadedBy, uploadedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "project", action: "upload", resourceType: "site_photo", resourceId: p.id, outcome: "success" },
      });
    });
  });
}
